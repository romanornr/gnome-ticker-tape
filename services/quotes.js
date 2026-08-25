import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';

import {buildEntries} from './entry-model.js';
import {QuoteUpdateScheduler} from './quote-update-scheduler.js';
import {QuoteStore} from './quote-store.js';
import {HyperliquidProvider} from './providers/hyperliquid-live.js';
import {KrakenProvider} from './providers/kraken-live.js';
import {restProvider} from './providers/rest-quotes.js';
import {createLoadingEntries} from '../utils/format.js';
import {
    loadRefreshIntervalSeconds,
    loadTickerConfigs,
    SETTINGS_KEYS,
} from '../utils/settings.js';
import {createMarketScheduleNow, shouldRefreshTicker} from '../utils/market-schedule.js';

/*
 * Top-level market-data orchestration runs settings -> providers -> QuoteStore -> entries.
 * Provider formats, schedule policy, and display formatting remain outside this class.
 */
export const QuotesService = GObject.registerClass({
    Signals: {
        'entries-changed': {},
    },
}, class QuotesService extends GObject.Object {
    _init(uuid, settings) {
        super._init();
        this._uuid = uuid;
        this._settings = settings;
        this._settingsSignalIds = [];
        this._session = null;
        this._failedProviders = new Set();
        this._tickers = loadTickerConfigs(this._settings);
        this._refreshIntervalSeconds = loadRefreshIntervalSeconds(this._settings);
        this._entries = createLoadingEntries(this._tickers);
        this._quoteStore = new QuoteStore();
        const liveProviderOptions = {
            uuid,
            onQuotes: quotesBySymbol => this._handleLiveQuotes(quotesBySymbol),
            onStale: tickers => this._handleStaleTickers(tickers),
        };
        this._liveProviders = [
            new KrakenProvider(liveProviderOptions),
            new HyperliquidProvider(liveProviderOptions),
        ];
        this._pollProviders = [restProvider, ...this._liveProviders];
        this._scheduler = new QuoteUpdateScheduler({
            onRefresh: forced => this._refreshQuotes(forced),
            onReconnectLiveProviders: () => this._liveProviders.forEach(provider => provider.reconnectNow()),
            onRebuildEntries: () => {
                this._entries = buildEntries(this._tickers, this._quoteStore, this._entries);
                this.emit('entries-changed');
                this._scheduler.schedulePriceFlashReset(this._entries);
            },
            onResetPriceFlash: nextEntries => {
                this._entries = nextEntries;
                this.emit('entries-changed');
            },
        });
    }

    start() {
        this._session = new Soup.Session();
        this._connectSettingsSignals();
        this.emit('entries-changed');

        this._liveProviders.forEach(provider => provider.start(this._session));
        this._liveProviders.forEach(provider => provider.updateSubscriptions(this._tickers));

        this._scheduler.scheduleRefreshTimer(this._refreshIntervalSeconds);
        this._scheduler.requestRefresh(true);
    }

    stop() {
        const session = this._session;
        this._session = null;

        this._settingsSignalIds.forEach(signalId => this._settings.disconnect(signalId));
        this._scheduler.stop();
        this._liveProviders.forEach(provider => provider.stop());
        session.abort();
    }

    getEntries() {
        return this._entries;
    }

    /*
     * A refresh pass first decides what needs data right now, then delegates to
     * the provider that owns each ticker. Live symbols remain in normal-cadence
     * REST fallback until their websocket subscription becomes ready.
     */
    async _refreshQuotes(forceRefreshAll = false) {
        const session = this._session;
        const configuration = this._tickers;
        const now = createMarketScheduleNow();
        const tickersToRefresh = forceRefreshAll
            ? configuration
            : configuration.filter(ticker => this._shouldRefreshTicker(ticker, now));
        const providerRefreshPlan = this._pollProviders
            .map(provider => {
                const ownedTickers = tickersToRefresh.filter(ticker => provider.ownsTicker(ticker));
                return {provider, tickers: provider.selectPollTickers(ownedTickers)};
            })
            .filter(({tickers}) => tickers.length > 0);

        await Promise.all(providerRefreshPlan.map(
            ({provider, tickers}) => this._pollProvider(provider, tickers, session, configuration)
        ));
    }

    _connectSettingsSignals() {
        this._settingsSignalIds = [
            this._settings.connect(`changed::${SETTINGS_KEYS.TICKERS_JSON}`, () => {
                this._tickers = loadTickerConfigs(this._settings);
                this._quoteStore.prune(this._tickers);
                this._scheduler.requestEntriesUpdate(true);
                this._liveProviders.forEach(provider => provider.updateSubscriptions(this._tickers));
                this._scheduler.requestRefresh(true);
            }),
            this._settings.connect(`changed::${SETTINGS_KEYS.REFRESH_INTERVAL_SECONDS}`, () => {
                this._refreshIntervalSeconds = loadRefreshIntervalSeconds(this._settings);
                this._scheduler.scheduleRefreshTimer(this._refreshIntervalSeconds);
            }),
        ];
    }

    /* Async provider results belong only to the session and ticker configuration that requested them. */
    async _pollProvider(provider, tickers, session, configuration) {
        try {
            const quotesBySymbol = await provider.poll(tickers, {session});
            if (this._session !== session || this._tickers !== configuration)
                return;

            this._failedProviders.delete(provider);
            this._quoteStore.recordPoll(tickers, quotesBySymbol);
        } catch (error) {
            if (this._session !== session || this._tickers !== configuration)
                return;

            this._quoteStore.markStale(tickers);
            if (!this._failedProviders.has(provider)) {
                this._failedProviders.add(provider);
                logError(error, `${this._uuid}: failed to poll ${provider.id} quotes`);
            }
        }

        this._scheduler.requestEntriesUpdate(false);
    }

    _handleLiveQuotes(quotesBySymbol) {
        this._quoteStore.mergeQuotes(quotesBySymbol);
        this._scheduler.requestEntriesUpdate(false);
    }

    _handleStaleTickers(tickers) {
        this._quoteStore.markStale(tickers);
        this._scheduler.requestEntriesUpdate(true);
    }

    _shouldRefreshTicker(ticker, now) {
        const state = this._quoteStore.getState(ticker.symbol);
        if (state.stale)
            return true;

        return shouldRefreshTicker(
            ticker,
            now,
            state.lastRefreshUsec,
            this._refreshIntervalSeconds
        );
    }
});
