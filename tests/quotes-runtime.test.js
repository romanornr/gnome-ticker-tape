import GLib from 'gi://GLib';

import {buildEntries} from '../services/entry-model.js';
import {QuoteUpdateScheduler} from '../services/quote-update-scheduler.js';
import {QuotesService} from '../services/quotes.js';
import {ASSET_CATEGORIES} from '../utils/asset-categories.js';
import {MARKET_SESSION_IDS} from '../utils/market-sessions.js';
import {SETTINGS_KEYS} from '../utils/settings.js';
import {assertDeepEqual, assertEqual} from './support/assert.js';

export async function runTests() {
    await testServicePipeline();
    await testProviderFailureDeduplication();
    await testSettingsReconfigurePipeline();
    await testStopRejectsLatePollCompletion();
    await testSchedulerSingleFlightAndStop();
}

async function testServicePipeline() {
    const tickers = [ticker('AAPL', 'aapl.us'), ticker('MSFT', 'msft.us')];
    const service = new QuotesService('test-uuid', createSettings(tickers));
    const firstProviderRendered = Promise.withResolvers();
    const allProvidersRendered = Promise.withResolvers();
    const secondPoll = Promise.withResolvers();
    service._liveProviders = [];
    service._pollProviders = [
        createPollProvider('first', 'aapl.us', async () => new Map([['AAPL.US', quote(210)]])),
        createPollProvider('second', 'msft.us', () => secondPoll.promise),
    ];
    service.connect('entries-changed', () => {
        const snapshot = service.getEntries().map(entry => entry.priceText);
        if (`${snapshot}` === '210.00,...')
            firstProviderRendered.resolve();
        if (`${snapshot}` === '210.00,410.00')
            allProvidersRendered.resolve();
    });

    service.start();
    assertDeepEqual(service.getEntries().map(entry => entry.priceText), ['...', '...'],
        'Service startup should publish loading entries before provider work finishes');
    await withTimeout(firstProviderRendered.promise, 'Fast provider result waited for the slow provider');
    assertDeepEqual(service.getEntries().map(entry => entry.priceText), ['210.00', '...'],
        'A completed provider should render while another provider is still pending');

    service._scheduler._lastEntriesUpdateUsec = 0;
    secondPoll.resolve(new Map([['MSFT.US', quote(410)]]));
    await withTimeout(allProvidersRendered.promise, 'Timed out waiting for the final provider snapshot');
    service.stop();
}

async function testProviderFailureDeduplication() {
    const tickers = [ticker('AAPL', 'aapl.us')];
    const service = new QuotesService('test-uuid', createSettings(tickers));
    const outcomes = [
        new Error('first failure'),
        new Error('repeated failure'),
        new Map([['AAPL.US', quote(210)]]),
        new Error('failure after recovery'),
    ];
    const provider = createPollProvider('fixture', 'aapl.us', async () => {
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome;
    });
    const errors = [];
    const originalLogError = globalThis.logError;
    globalThis.logError = (error, message) => errors.push(`${message}: ${error.message}`);
    service._session = {};
    service._scheduler = {requestEntriesUpdate() {}};
    const configuration = service._tickers;

    try {
        for (let index = 0; index < 4; index += 1)
            await service._pollProvider(provider, tickers, service._session, configuration);
    } finally {
        globalThis.logError = originalLogError;
    }

    assertDeepEqual(errors, [
        'test-uuid: failed to poll fixture quotes: first failure',
        'test-uuid: failed to poll fixture quotes: failure after recovery',
    ], 'A provider should log once per rejected-poll streak');
}

async function testSettingsReconfigurePipeline() {
    const initialTickers = [ticker('AAPL', 'aapl.us'), ticker('MSFT', 'msft.us')];
    const nextTickers = [ticker('AAPL', 'aapl.us'), ticker('NVDA', 'nvda.us')];
    const settings = createSettings(initialTickers);
    const service = new QuotesService('test-uuid', settings);
    const callbacks = [];
    const oldPoll = Promise.withResolvers();
    service._session = {abort() {}};
    service._quoteStore.recordPoll(initialTickers, new Map([
        ['AAPL.US', quote(210)],
        ['MSFT.US', quote(410)],
    ]));
    service._entries = buildEntries(initialTickers, service._quoteStore, service._displaySettings);
    service._pollProviders = [createPollProvider('fixture', null, () => oldPoll.promise)];
    service._liveProviders = [{
        updateSubscriptions: tickers => callbacks.push(['subscriptions', tickers.map(item => item.symbol)]),
        stop() {},
    }];
    service._scheduler = {
        requestEntriesUpdate(immediate) {
            callbacks.push(['rebuild', immediate]);
            service._entries = buildEntries(
                service._tickers, service._quoteStore, service._displaySettings, service._entries);
        },
        requestRefresh: forced => callbacks.push(['refresh', forced]),
        stop() {},
    };
    service._connectSettingsSignals();

    const staleRefresh = service._refreshQuotes(true);
    settings.values[SETTINGS_KEYS.TICKERS_JSON] = JSON.stringify(nextTickers);
    settings.trigger(`changed::${SETTINGS_KEYS.TICKERS_JSON}`);
    oldPoll.resolve(new Map([['AAPL.US', quote(999)], ['MSFT.US', quote(999)]]));
    await staleRefresh;

    assertDeepEqual(service.getEntries().map(entry => [entry.symbol, entry.priceText]), [
        ['aapl.us', '210.00'],
        ['nvda.us', '...'],
    ], 'Reconfiguration should retain cached prices and load only new tickers');
    assertDeepEqual([
        service._quoteStore.getState('aapl.us').quote.price,
        service._quoteStore.getState('msft.us'),
    ], [210, {quote: null, lastRefreshUsec: 0, stale: false}],
    'A stale configuration result must not restore removed or overwrite retained state');
    assertDeepEqual(callbacks, [
        ['rebuild', true],
        ['subscriptions', ['aapl.us', 'nvda.us']],
        ['refresh', true],
    ], 'A ticker-setting change should rebuild, resubscribe, and refresh without rescheduling');
    service.stop();
}

async function testStopRejectsLatePollCompletion() {
    const service = new QuotesService('test-uuid', createSettings([ticker('AAPL', 'aapl.us')]));
    const {promise: pollCompletion, resolve: finishPoll} = Promise.withResolvers();
    const entryUpdateRequests = [];
    service._session = {abort() {}};
    service._liveProviders = [];
    service._pollProviders = [createPollProvider('fixture', null, () => pollCompletion)];
    service._scheduler = {
        requestEntriesUpdate: () => entryUpdateRequests.push(true),
        stop() {},
    };

    const refresh = service._refreshQuotes(true);
    service.stop();
    finishPoll(new Map([['AAPL.US', quote(999)]]));

    await refresh;
    assertEqual(entryUpdateRequests.length, 0,
        'A late provider completion should not schedule a UI rebuild');
    assertEqual(service._quoteStore.getState('aapl.us').quote, null,
        'A late provider completion should not mutate quote state');
}

async function testSchedulerSingleFlightAndStop() {
    const firstPass = Promise.withResolvers();
    const scopes = [];
    const rebuilds = [];
    const reconnects = [];
    const networkMonitor = new FakeNetworkMonitor();
    const scheduler = new QuoteUpdateScheduler({
        onRefresh(forced) {
            scopes.push(forced);
            if (scopes.length === 1)
                return firstPass.promise;
        },
        onReconnectLiveProviders: () => reconnects.push(true),
        onRebuildEntries: () => rebuilds.push(true),
        networkMonitor,
    });
    scheduler.scheduleRefreshTimer(3600);
    scheduler.requestRefresh(false);
    scheduler.requestRefresh(false);
    firstPass.resolve();
    await firstPass.promise;
    assertDeepEqual(scopes, [false], 'An overlapping ordinary timer tick should be discarded');

    networkMonitor.emit(true);
    networkMonitor.emit(false);
    networkMonitor.emit(true);
    assertDeepEqual([reconnects.length, scopes], [1, [false, true]],
        'Only restored network availability should reconnect providers and force a refresh');

    scheduler.requestEntriesUpdate(true);
    scheduler.requestEntriesUpdate(false);
    const pendingUpdateId = scheduler._entriesUpdateTimeoutId;
    scheduler._lastEntriesUpdateUsec = 0;
    scheduler.requestEntriesUpdate(false);
    assertDeepEqual([
        scheduler._entriesUpdateTimeoutId,
        GLib.MainContext.default().find_source_by_id(pendingUpdateId),
        rebuilds.length,
    ], [0, null, 2],
    'A due rebuild should replace an older throttled source instead of running twice');
    scheduler.stop();

    const oldPass = Promise.withResolvers();
    const restartedPass = Promise.withResolvers();
    const queuedPassStarted = Promise.withResolvers();
    let lateCalls = 0;
    const lateScheduler = new QuoteUpdateScheduler({
        onRefresh: () => {
            lateCalls += 1;
            if (lateCalls === 1)
                return oldPass.promise;
            if (lateCalls === 2)
                return restartedPass.promise;
            queuedPassStarted.resolve();
        },
        networkMonitor: new FakeNetworkMonitor(),
    });
    lateScheduler.scheduleRefreshTimer(3600);
    lateScheduler.requestRefresh(false);
    lateScheduler.stop();
    lateScheduler.scheduleRefreshTimer(3600);
    lateScheduler.requestRefresh(true);

    oldPass.resolve();
    await oldPass.promise;
    lateScheduler.requestRefresh(true);
    assertEqual(lateCalls, 2,
        'An old completion must not release the restarted lifecycle single-flight guard');

    restartedPass.resolve();
    await withTimeout(queuedPassStarted.promise, 'Timed out waiting for the queued forced refresh');
    assertEqual(lateCalls, 3,
        'A forced request should run after the active pass in its own lifecycle');
    lateScheduler.stop();
}

function ticker(label = 'AAPL', symbol = 'aapl.us') {
    return {
        label, symbol, priceDecimals: 2,
        marketSessionId: MARKET_SESSION_IDS.US_EQUITY_EXTENDED,
        assetCategory: ASSET_CATEGORIES.EQUITY, panelSide: 'right',
    };
}

function quote(price) {
    return {price, quoteDate: '20260825', previousClose: price - 1};
}

function createPollProvider(id, symbol, poll) {
    return {
        id, poll,
        ownsTicker: item => symbol === null || item.symbol === symbol,
        selectPollTickers: tickers => tickers,
    };
}

function createSettings(tickers = []) {
    const values = {
        [SETTINGS_KEYS.TICKERS_JSON]: JSON.stringify(tickers),
        [SETTINGS_KEYS.REFRESH_INTERVAL_SECONDS]: 300,
    };
    const handlers = new Map();
    return {
        values,
        get_string: key => values[key] ?? '',
        get_boolean: key => values[key] ?? false,
        get_uint: key => values[key] ?? 300,
        connect(signal, handler) {
            handlers.set(signal, handler);
            return signal;
        },
        disconnect: signal => handlers.delete(signal),
        trigger: signal => handlers.get(signal)(),
    };
}

class FakeNetworkMonitor {
    get_network_available() {
        return true;
    }

    connect(_signal, handler) {
        this._handler = handler;
        return 1;
    }

    disconnect() {}

    emit(available) {
        this._handler(this, available);
    }
}

function withTimeout(promise, message, milliseconds = 1000) {
    return new Promise((resolve, reject) => {
        let timeoutPending = true;
        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            timeoutPending = false;
            reject(new Error(message));
            return GLib.SOURCE_REMOVE;
        });

        promise.finally(() => {
            if (timeoutPending)
                GLib.Source.remove(timeoutId);
        }).then(resolve, reject);
    });
}
