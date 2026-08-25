import {QuotesService} from '../services/quotes.js';
import {QuoteUpdateScheduler} from '../services/quote-update-scheduler.js';
import {ASSET_CATEGORIES} from '../utils/asset-categories.js';
import {SETTINGS_KEYS} from '../utils/settings.js';
import {assertDeepEqual} from './support/assert.js';

export async function runTests() {
    await testProviderErrorRecovery();
    await testSchedulerRecoveryAndQueueing();
    await testLateCompletionAfterStop();
    await testLateCompletionAfterConfigChange();
}

async function testSchedulerRecoveryAndQueueing() {
    const firstRefresh = Promise.withResolvers();
    const refreshes = [];
    let reconnects = 0;
    const networkMonitor = {
        get_network_available: () => false,
        connect(_signal, handler) {
            this.handler = handler;
            return 1;
        },
        disconnect() {},
    };
    const scheduler = new QuoteUpdateScheduler({
        networkMonitor,
        onRefresh(forced) {
            refreshes.push(forced);
            return refreshes.length === 1 ? firstRefresh.promise : Promise.resolve();
        },
        onReconnectLiveProviders() {
            reconnects += 1;
        },
        onRebuildEntries() {},
        onResetPriceFlash() {},
    });
    scheduler.scheduleRefreshTimer(3600);
    networkMonitor.handler(null, true);
    networkMonitor.handler(null, true);
    scheduler.requestRefresh(false);
    scheduler.requestRefresh(true);
    firstRefresh.resolve();
    await Promise.resolve();
    await Promise.resolve();
    scheduler.stop();

    assertDeepEqual([reconnects, refreshes], [1, [true, true]],
        'Network restoration should reconnect once and overlapping refreshes should retain only a forced pass');
}

async function testProviderErrorRecovery() {
    const item = ticker('AAPL', 'aapl.us');
    const service = new QuotesService('test-uuid', createSettings([item]));
    const outcomes = [
        new Error('first'),
        new Error('duplicate'),
        new Map([['AAPL.US', quote(210)]]),
        new Error('after success'),
    ];
    const provider = pollProvider(() => {
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome;
    });
    const errors = [];
    const originalLogError = globalThis.logError;
    globalThis.logError = (error, message) => errors.push(`${message}: ${error.message}`);
    service._session = {};
    service._scheduler = {requestEntriesUpdate() {}};

    try {
        for (let index = 0; index < 4; index += 1)
            await service._pollProvider(provider, [item], service._session, service._tickers);
    } finally {
        globalThis.logError = originalLogError;
    }

    assertDeepEqual(errors, [
        'test-uuid: failed to poll fixture quotes: first',
        'test-uuid: failed to poll fixture quotes: after success',
    ], 'A successful poll should reset first-error reporting for the provider');
}

async function testLateCompletionAfterStop() {
    const item = ticker('AAPL', 'aapl.us');
    const deferred = Promise.withResolvers();
    const {service, updates} = serviceFixture([item], deferred.promise);
    const refresh = service._refreshQuotes(true);

    service.stop();
    deferred.resolve(new Map([['AAPL.US', quote(999)]]));
    await refresh;

    assertDeepEqual([service._quoteStore.getState(item.symbol).quote, updates.length], [null, 0],
        'A poll completing after stop should neither mutate state nor rebuild entries');
}

async function testLateCompletionAfterConfigChange() {
    const oldTicker = ticker('AAPL', 'aapl.us');
    const retainedTicker = ticker('MSFT', 'msft.us');
    const newTicker = ticker('NVDA', 'nvda.us');
    const deferred = Promise.withResolvers();
    const settings = createSettings([oldTicker, retainedTicker]);
    const {service, updates} = serviceFixture([oldTicker, retainedTicker], deferred.promise, settings);
    service._quoteStore.recordPoll([retainedTicker], new Map([['MSFT.US', quote(300)]]));
    service._connectSettingsSignals();
    const refresh = service._refreshQuotes(true);

    settings.values[SETTINGS_KEYS.TICKERS_JSON] = JSON.stringify([retainedTicker, newTicker]);
    settings.trigger(`changed::${SETTINGS_KEYS.TICKERS_JSON}`);
    deferred.resolve(new Map([['AAPL.US', quote(999)]]));
    await refresh;

    assertDeepEqual([
        service._quoteStore.getState(oldTicker.symbol).quote,
        service._quoteStore.getState(retainedTicker.symbol).quote.price,
        service._quoteStore.getState(newTicker.symbol).quote,
        updates,
    ], [null, 300, null, [true]], 'Config changes should retain cached quotes and discard old poll completions');
    service.stop();
}

function serviceFixture(tickers, poll, settings = createSettings(tickers)) {
    const service = new QuotesService('test-uuid', settings);
    const updates = [];
    service._session = {abort() {}};
    service._pollProviders = [pollProvider(() => poll)];
    service._liveProviders = [{updateSubscriptions() {}, stop() {}}];
    service._scheduler = {
        requestEntriesUpdate: immediate => updates.push(immediate),
        requestRefresh() {},
        stop() {},
    };
    return {service, updates};
}

function ticker(label, symbol) {
    return {
        label,
        symbol,
        priceDecimals: 2,
        assetCategory: ASSET_CATEGORIES.EQUITY,
        panelSide: 'right',
    };
}

function quote(price) {
    return {price, quoteDate: '20260825', previousClose: price - 1};
}

function pollProvider(poll) {
    return {
        id: 'fixture',
        ownsTicker: () => true,
        selectPollTickers: tickers => tickers,
        poll,
    };
}

function createSettings(tickers) {
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
