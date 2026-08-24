import Soup from 'gi://Soup?version=3.0';

import {HyperliquidProvider} from '../services/providers/hyperliquid-live.js';
import {KrakenProvider} from '../services/providers/kraken-live.js';
import {ASSET_CATEGORIES, CRYPTO_PROVIDERS} from '../utils/asset-categories.js';
import {assertDeepEqual, assertEqual} from './support/assert.js';

export async function runTests() {
    await testKrakenLivePipeline();
    await testHyperliquidLivePipeline();
    await testHandshakeOwnership();
    await testKrakenSymbolRejectionIsolation();
}

async function testKrakenLivePipeline() {
    const socket = new FakeWebsocket();
    const updates = [];
    const provider = new KrakenProvider({
        uuid: 'test',
        connectWebsocket: async () => socket,
        onQuotes: quotes => updates.push(projectQuotes(quotes)),
    });
    provider.start({});
    provider.updateSubscriptions([krakenTicker('BTC', 'btcusd', 'BTC/USD')]);
    await flushPromises();

    socket.emitText({
        method: 'subscribe',
        success: true,
        result: {channel: 'ticker', symbol: 'BTC/USD'},
    });
    socket.emitText({
        channel: 'ticker',
        data: [{
            symbol: 'BTC/USD',
            last: '104321.50',
            timestamp: '2026-03-22T12:34:56.789Z',
            change: '321.5',
        }],
    });

    assertDeepEqual(JSON.parse(socket.sentTexts[0]), {
        method: 'subscribe',
        params: {
            channel: 'ticker',
            event_trigger: 'trades',
            symbol: ['BTC/USD'],
            snapshot: true,
        },
    }, 'Kraken startup should subscribe once with the complete desired symbol set');
    assertDeepEqual(updates, [[
        ['BTCUSD', {price: 104321.5, previousClose: 104000}],
    ]], 'Kraken traffic should reach consumers as normalized saved-symbol quotes');
    assertEqual(provider.isConnected(), true,
        'A successful Kraken handshake should keep REST fallback disabled');
    provider.stop();
    assertEqual(socket.closeCalls, 1,
        'Stopping Kraken should close its adopted socket once');
}

async function testHyperliquidLivePipeline() {
    const socket = new FakeWebsocket();
    const updates = [];
    const provider = new HyperliquidProvider({
        uuid: 'test',
        connectWebsocket: async () => socket,
        onQuotes: quotes => updates.push(projectQuotes(quotes)),
    });
    provider.start({});
    provider.updateSubscriptions([
        hyperliquidTicker('PURR', 'purrusdc', 'PURR/USDC'),
        hyperliquidTicker('BTC', 'btc', 'BTC'),
    ]);
    await flushPromises();

    socket.emitText({
        channel: 'subscriptionResponse',
        data: {type: 'activeAssetCtx'},
    });
    socket.emitText({
        channel: 'activeAssetCtx',
        data: {coin: ' purr / usdc ', ctx: {midPx: '0.42', prevDayPx: '0.39'}},
    });

    assertDeepEqual(socket.sentTexts.map(text => JSON.parse(text).subscription.coin), [
        'PURR/USDC',
        'BTC',
    ], 'Hyperliquid startup should issue one subscription for each desired market');
    assertDeepEqual(updates, [[
        ['PURRUSDC', {price: 0.42, previousClose: 0.39}],
    ]], 'Hyperliquid traffic should reach consumers as normalized saved-symbol quotes');
    provider.stop();
}

async function testHandshakeOwnership() {
    const attempts = [];
    const provider = new KrakenProvider({
        uuid: 'test',
        connectWebsocket(_session, _url, cancellable) {
            return new Promise(resolve => attempts.push({cancellable, resolve}));
        },
    });
    provider.start({});
    provider.updateSubscriptions([krakenTicker('BTC', 'btcusd', 'BTC/USD')]);
    provider.updateSubscriptions([krakenTicker('BTC', 'btcusd', 'BTC/USD')]);
    assertEqual(attempts.length, 1,
        'Repeated subscription updates should share the active handshake');

    provider.updateSubscriptions([krakenTicker('ETH', 'ethusd', 'ETH/USD')]);
    assertEqual(attempts.length, 2,
        'A changed symbol set should replace the pending handshake');
    assertEqual(attempts[0].cancellable.is_cancelled(), true,
        'Replacing a handshake should cancel its Soup operation');

    const staleSocket = new FakeWebsocket();
    attempts[0].resolve(staleSocket);
    await flushPromises();
    assertEqual(staleSocket.closeCalls, 1,
        'A connector that completes after invalidation should have its socket closed');

    const activeSocket = new FakeWebsocket();
    attempts[1].resolve(activeSocket);
    await flushPromises();
    assertEqual(provider.isConnected(), true,
        'Only the handshake for the current session and symbols should be adopted');

    provider.updateSubscriptions([krakenTicker('SOL', 'solusd', 'SOL/USD')]);
    assertEqual(activeSocket.closeCalls, 1,
        'Resubscription should release the previous active socket');
    provider.stop();
    const stoppedSocket = new FakeWebsocket();
    attempts[2].resolve(stoppedSocket);
    await flushPromises();
    assertEqual(stoppedSocket.closeCalls, 1,
        'A handshake completing after stop should never resurrect the provider');
    assertEqual(provider.isConnected(), false,
        'Stopping should leave no active websocket after late completions');
}

async function testKrakenSymbolRejectionIsolation() {
    const socket = new FakeWebsocket();
    const stale = [];
    const updates = [];
    const diagnostics = [];
    const provider = new KrakenProvider({
        uuid: 'test',
        connectWebsocket: async () => socket,
        onStale: tickers => stale.push(tickers.map(ticker => ticker.symbol)),
        onQuotes: quotes => updates.push(projectQuotes(quotes)),
    });
    provider.start({});
    provider.updateSubscriptions([
        krakenTicker('BTC', 'btcusd', 'BTC/USD'),
        krakenTicker('Invalid', 'invalidusd', 'NOTAREALPAIR/USD'),
    ]);
    await flushPromises();

    const originalLog = globalThis.log;
    globalThis.log = message => diagnostics.push(message);
    try {
        const rejection = {
            error: 'Currency pair not supported NOTAREALPAIR/USD',
            method: 'subscribe',
            success: false,
            symbol: 'NOTAREALPAIR/USD',
        };
        socket.emitText(rejection);
        socket.emitText(rejection);
        socket.emitText({
            error: 'No longer subscribed',
            method: 'subscribe',
            success: false,
            symbol: 'OLD/USD',
        });
        socket.emitText({
            method: 'subscribe',
            success: true,
            result: {channel: 'ticker', symbol: 'BTC/USD'},
        });
        socket.emitText({
            channel: 'ticker',
            data: [{
                symbol: 'BTC/USD',
                last: '100',
                timestamp: '2026-03-22T12:34:56.789Z',
                change: '5',
            }],
        });
    } finally {
        globalThis.log = originalLog;
    }

    assertDeepEqual(stale, [['invalidusd'], ['invalidusd']],
        'A Kraken rejection should mark only its matching saved ticker stale and ignore unmatched symbols');
    assertEqual(diagnostics.length, 2,
        'Duplicate rejection frames should emit one diagnostic for each distinct rejected symbol epoch');
    assertEqual(socket.closeCalls, 0,
        'A symbol rejection should not reconnect an otherwise healthy shared socket');
    assertDeepEqual(
        provider.selectPollTickers([
            krakenTicker('BTC', 'btcusd', 'BTC/USD'),
            krakenTicker('Invalid', 'invalidusd', 'NOTAREALPAIR/USD'),
        ]).map(ticker => ticker.symbol),
        ['invalidusd'],
        'A rejected pair should use REST fallback without polling healthy live subscriptions'
    );
    assertDeepEqual(updates, [[
        ['BTCUSD', {price: 100, previousClose: 95}],
    ]], 'Valid Kraken traffic should continue after another symbol is rejected');
    provider.stop();
}

function krakenTicker(label, symbol, liveSymbol) {
    return {
        label,
        symbol,
        liveSymbol,
        assetCategory: ASSET_CATEGORIES.CRYPTO,
        cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
    };
}

function hyperliquidTicker(label, symbol, liveSymbol) {
    return {
        label,
        symbol,
        liveSymbol,
        assetCategory: ASSET_CATEGORIES.CRYPTO,
        cryptoProvider: CRYPTO_PROVIDERS.HYPERLIQUID,
    };
}

function projectQuotes(quotes) {
    return Array.from(quotes.entries()).map(([symbol, quote]) => [symbol, {
        price: quote.price,
        previousClose: quote.previousClose,
    }]);
}

class FakeWebsocket {
    constructor() {
        this.handlers = new Map();
        this.nextSignalId = 1;
        this.sentTexts = [];
        this.closeCalls = 0;
    }

    connect(signal, handler) {
        const signalId = this.nextSignalId;
        this.nextSignalId += 1;
        this.handlers.set(signalId, {signal, handler});
        return signalId;
    }

    disconnect(signalId) {
        this.handlers.delete(signalId);
    }

    send_text(text) {
        this.sentTexts.push(text);
    }

    get_state() {
        return Soup.WebsocketState.OPEN;
    }

    close(_code, _reason) {
        this.closeCalls += 1;
    }

    emitText(payload) {
        const bytes = {
            get_data: () => new TextEncoder().encode(JSON.stringify(payload)),
        };
        for (const {signal, handler} of this.handlers.values()) {
            if (signal === 'message')
                handler(this, Soup.WebsocketDataType.TEXT, bytes);
        }
    }
}

async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
}
