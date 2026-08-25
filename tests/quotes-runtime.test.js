import GLib from 'gi://GLib';

import {QuoteUpdateScheduler} from '../services/quote-update-scheduler.js';
import {QuotesService} from '../services/quotes.js';
import {ASSET_CATEGORIES} from '../utils/asset-categories.js';
import {MARKET_SESSION_IDS} from '../utils/market-sessions.js';
import {SETTINGS_KEYS} from '../utils/settings.js';
import {assertDeepEqual, assertEqual} from './support/assert.js';

export async function runTests() {
    await testServicePipeline();
    await testProviderHealthEpoch();
    testSettingsReconfigurePipeline();
    await testStopRejectsLatePollCompletion();
    await testSchedulerSingleFlightAndStop();
}

async function testServicePipeline() {
    const service = new QuotesService('test-uuid', createSettings([ticker('AAPL', 'aapl.us')]));
    const snapshots = [];
    const {promise: finalSnapshot, resolve: resolveFinalSnapshot} = Promise.withResolvers();
    service._providers = [{
        id: 'fixture',
        ownsTicker: () => true,
        poll: async () => new Map([['AAPL.US', {
            price: 210,
            quoteDate: '20260825',
            previousClose: 205,
        }]]),
    }];
    service.connect('entries-changed', () => {
        const snapshot = service.getEntries().map(entry => entry.priceText);
        snapshots.push(snapshot);
        if (snapshot[0] === '210.00')
            resolveFinalSnapshot();
    });

    service.start();
    await withTimeout(finalSnapshot, 'Timed out waiting for the provider-backed entry snapshot');

    assertDeepEqual(snapshots[0], ['...'],
        'Service startup should publish loading entries before provider work finishes');
    assertEqual(service.getEntries()[0].priceText, '210.00',
        'A provider result should flow through the store into the rendered entry snapshot');
    service.stop();
}

async function testProviderHealthEpoch() {
    const service = new QuotesService('test-uuid', createSettings());
    const tickers = [ticker('AAPL', 'aapl.us'), ticker('MSFT', 'msft.us')];
    const outcomes = [
        new Map([['AAPL.US', quote(210)]]),
        new Map([['AAPL.US', quote(211)]]),
        new Error('provider unavailable'),
        new Error('provider still unavailable'),
        new Map([['AAPL.US', quote(212)], ['MSFT.US', quote(410)]]),
    ];
    const provider = {
        id: 'fixture',
        async poll() {
            const outcome = outcomes.shift();
            if (outcome instanceof Error)
                throw outcome;
            return outcome;
        },
    };
    const warnings = [];
    const errors = [];
    const originalLog = globalThis.log;
    const originalLogError = globalThis.logError;
    globalThis.log = message => warnings.push(message);
    globalThis.logError = (error, message) => errors.push(`${message}: ${error.message}`);
    service._session = {};

    try {
        for (let index = 0; index < 5; index += 1)
            await service._pollProvider(provider, tickers);
    } finally {
        globalThis.log = originalLog;
        globalThis.logError = originalLogError;
    }

    assertDeepEqual(warnings, [
        'test-uuid: fixture quote provider returned 1 of 2 requested quote(s).',
        'test-uuid: fixture quote provider recovered.',
    ], 'Repeated partial polls should warn once per health epoch and once on recovery');
    assertDeepEqual(errors, ['test-uuid: failed to poll fixture quotes: provider unavailable'],
        'Repeated failures should log one error per health epoch');
}

function testSettingsReconfigurePipeline() {
    const settings = createSettings([ticker('AAPL', 'aapl.us')]);
    const service = new QuotesService('test-uuid', settings);
    const callbacks = [];
    service._session = {abort() {}};
    service._providers = [{
        updateSubscriptions(tickers) {
            callbacks.push(['subscriptions', tickers.map(item => item.symbol)]);
        },
    }];
    service._scheduler = {
        scheduleRefreshTimer(interval) {
            callbacks.push(['schedule', interval]);
        },
        requestRefresh(forced) {
            callbacks.push(['refresh', forced]);
        },
        stop() {},
    };
    service._connectSettingsSignals();

    settings.values[SETTINGS_KEYS.TICKERS_JSON] = JSON.stringify([ticker('MSFT', 'msft.us')]);
    settings.trigger(`changed::${SETTINGS_KEYS.TICKERS_JSON}`);

    assertDeepEqual(service.getEntries().map(entry => [entry.symbol, entry.priceText]), [
        ['msft.us', '...'],
    ], 'A ticker-setting change should replace the public snapshot with the new loading entry');
    assertDeepEqual(callbacks, [
        ['schedule', 300],
        ['subscriptions', ['msft.us']],
        ['refresh', true],
    ], 'A ticker-setting change should reschedule, resubscribe, and force one refresh');
    service.stop();
}

async function testStopRejectsLatePollCompletion() {
    const service = new QuotesService('test-uuid', createSettings([ticker('AAPL', 'aapl.us')]));
    const {promise: pollCompletion, resolve: finishPoll} = Promise.withResolvers();
    let entryUpdateRequests = 0;
    service._session = {abort() {}};
    service._providers = [{
        ownsTicker: () => true,
        poll: () => pollCompletion,
    }];
    service._scheduler = {
        requestEntriesUpdate() {
            entryUpdateRequests += 1;
        },
        stop() {},
    };

    const refresh = service._refreshQuotes(true);
    service.stop();
    finishPoll(new Map([['AAPL.US', quote(999)]]));

    await refresh;
    assertEqual(entryUpdateRequests, 0,
        'A late provider completion should not schedule a UI rebuild');
    assertEqual(service.getEntries()[0].priceText, '...',
        'Stopping should leave a clean loading snapshot rather than expose late data');
}

async function testSchedulerSingleFlightAndStop() {
    const firstPass = Promise.withResolvers();
    const scopes = [];
    let rebuilds = 0;
    let reconnects = 0;
    const networkMonitor = new FakeNetworkMonitor();
    const scheduler = new QuoteUpdateScheduler({
        onRefresh(forced) {
            scopes.push(forced);
            if (scopes.length === 1)
                return firstPass.promise;
        },
        onReconnectLiveProviders() {
            reconnects += 1;
        },
        onRebuildEntries() {
            rebuilds += 1;
        },
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
    assertDeepEqual([reconnects, scopes], [1, [false, true]],
        'Only restored network availability should reconnect providers and force a refresh');

    scheduler.requestEntriesUpdate(true);
    scheduler.requestEntriesUpdate(false);
    const pendingUpdateId = scheduler._entriesUpdateTimeoutId;
    scheduler._lastEntriesUpdateUsec = 0;
    scheduler.requestEntriesUpdate(false);
    assertDeepEqual([
        scheduler._entriesUpdateTimeoutId,
        GLib.MainContext.default().find_source_by_id(pendingUpdateId),
        rebuilds,
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
        label,
        symbol,
        priceDecimals: 2,
        marketSessionId: MARKET_SESSION_IDS.US_EQUITY_EXTENDED,
        assetCategory: ASSET_CATEGORIES.EQUITY,
        panelSide: 'right',
    };
}

function quote(price) {
    return {price, quoteDate: '20260825', previousClose: price - 1};
}

function createSettings(tickers = []) {
    return {
        values: {
            [SETTINGS_KEYS.TICKERS_JSON]: JSON.stringify(tickers),
            [SETTINGS_KEYS.REFRESH_INTERVAL_SECONDS]: 300,
        },
        handlers: new Map(),
        get_string(key) {
            return this.values[key] ?? '';
        },
        get_boolean(key) {
            return this.values[key] ?? false;
        },
        get_uint(key) {
            return this.values[key] ?? 300;
        },
        connect(signal, handler) {
            this.handlers.set(signal, handler);
            return signal;
        },
        disconnect(signal) {
            this.handlers.delete(signal);
        },
        trigger(signal) {
            this.handlers.get(signal)();
        },
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
