import GLib from 'gi://GLib';

import {QuotesCoordinator} from '../services/quotes-coordinator.js';
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
    await testCoordinatorSingleFlightAndStop();
}

async function testServicePipeline() {
    const service = new QuotesService('test-uuid', createSettings([ticker('AAPL', 'aapl.us')]));
    const snapshots = [];
    let resolveFinalSnapshot;
    const finalSnapshot = new Promise(resolve => {
        resolveFinalSnapshot = resolve;
    });
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

    assertDeepEqual({
        warningCount: warnings.length,
        errorCount: errors.length,
        degraded: warnings[0]?.includes('returned 1 of 2'),
        recovered: warnings.at(-1)?.includes('recovered'),
        failure: errors[0]?.includes('provider unavailable'),
    }, {
        warningCount: 2,
        errorCount: 1,
        degraded: true,
        recovered: true,
        failure: true,
    }, 'Repeated partial and failed polls should log once per health epoch and once on recovery');
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
        stop() {
        },
    }];
    service._coordinator = {
        scheduleRefreshTimer(interval) {
            callbacks.push(['schedule', interval]);
        },
        requestRefresh(forced) {
            callbacks.push(['refresh', forced]);
        },
        stop() {
        },
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
    let finishPoll = null;
    let entryUpdateRequests = 0;
    service._session = {abort() {}};
    service._providers = [{
        id: 'deferred',
        ownsTicker: () => true,
        poll: () => new Promise(resolve => {
            finishPoll = resolve;
        }),
        stop() {
        },
    }];
    service._coordinator = {
        requestEntriesUpdate() {
            entryUpdateRequests += 1;
        },
        stop() {
        },
    };

    const refresh = service._refreshQuotes(true);
    service.stop();
    finishPoll(new Map([['AAPL.US', quote(999)]]));

    assertEqual(await refresh, null,
        'A provider completion after stop should be discarded');
    assertEqual(entryUpdateRequests, 0,
        'A late provider completion should not schedule a UI rebuild');
    assertEqual(service.getEntries()[0].priceText, '...',
        'Stopping should leave a clean loading snapshot rather than expose late data');
}

async function testCoordinatorSingleFlightAndStop() {
    const scopes = [];
    let finishFirst = null;
    let resolveSecondPassStarted;
    const firstPass = new Promise(resolve => {
        finishFirst = resolve;
    });
    const secondPassStarted = new Promise(resolve => {
        resolveSecondPassStarted = resolve;
    });
    const coordinator = new QuotesCoordinator({
        onRefresh: async forced => {
            scopes.push(forced);
            if (scopes.length === 1)
                await firstPass;
            else
                resolveSecondPassStarted();
            return true;
        },
        networkMonitor: new FakeNetworkMonitor(),
    });
    coordinator.scheduleRefreshTimer(3600);
    coordinator.requestRefresh(false);
    coordinator.requestRefresh(false);
    coordinator.requestRefresh(true);
    assertDeepEqual(scopes, [false],
        'Overlapping refresh requests should keep one provider pass in flight');

    finishFirst();
    await withTimeout(secondPassStarted, 'Timed out waiting for the queued refresh pass');
    assertDeepEqual(scopes, [false, true],
        'Queued refreshes should coalesce once, with forced scope winning');
    coordinator.stop();

    let finishOldPass = null;
    let finishRestartedPass = null;
    let resolveRestartedPassStarted = null;
    let resolveQueuedPassStarted = null;
    const oldPass = new Promise(resolve => {
        finishOldPass = resolve;
    });
    const restartedPass = new Promise(resolve => {
        finishRestartedPass = resolve;
    });
    const restartedPassStarted = new Promise(resolve => {
        resolveRestartedPassStarted = resolve;
    });
    const queuedPassStarted = new Promise(resolve => {
        resolveQueuedPassStarted = resolve;
    });
    let lateCalls = 0;
    const lateCoordinator = new QuotesCoordinator({
        onRefresh: () => {
            lateCalls += 1;
            if (lateCalls === 1)
                return oldPass;
            if (lateCalls === 2) {
                resolveRestartedPassStarted();
                return restartedPass;
            }

            resolveQueuedPassStarted();
            return true;
        },
        networkMonitor: new FakeNetworkMonitor(),
    });
    lateCoordinator.scheduleRefreshTimer(3600);
    lateCoordinator.requestRefresh(false);
    lateCoordinator.requestRefresh(true);
    lateCoordinator.stop();
    lateCoordinator.scheduleRefreshTimer(3600);
    lateCoordinator.requestRefresh(true);
    await withTimeout(restartedPassStarted, 'Timed out waiting for the restarted lifecycle refresh');

    finishOldPass(false);
    await oldPass;
    lateCoordinator.requestRefresh(false);
    assertEqual(lateCalls, 2,
        'An old completion must not release the restarted lifecycle single-flight guard');

    finishRestartedPass(true);
    await withTimeout(queuedPassStarted, 'Timed out waiting for the restarted lifecycle queued refresh');
    assertEqual(lateCalls, 3,
        'Restarted lifecycle requests should still coalesce and run after its own active pass');
    lateCoordinator.stop();
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
            this.handlers.get(signal)?.();
        },
    };
}

class FakeNetworkMonitor {
    constructor() {
        this.handler = null;
    }

    get_network_available() {
        return true;
    }

    connect(_signal, handler) {
        this.handler = handler;
        return 1;
    }

    disconnect(_signalId) {
        this.handler = null;
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

        promise.then(value => {
            if (timeoutPending)
                GLib.Source.remove(timeoutId);
            resolve(value);
        }, error => {
            if (timeoutPending)
                GLib.Source.remove(timeoutId);
            reject(error);
        });
    });
}
