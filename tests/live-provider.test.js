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
    const tickers = [cryptoTicker('btcusd', 'BTC/USD')];
    const stale = [];
    const {provider, socket, updates} = await startProvider(KrakenProvider, tickers, {
        onStale: staleTickers => stale.push(staleTickers.map(ticker => ticker.symbol)),
    });
    assertDeepEqual(provider.selectPollTickers(tickers).map(ticker => ticker.symbol), ['btcusd'],
        'Socket adoption alone should not disable REST fallback');

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
    assertDeepEqual([
        provider.selectPollTickers(tickers),
        provider._hasLiveTrafficTimedOut(provider._lastMessageUsec + 60_000_000),
    ], [[], true], 'Acknowledged traffic should disable fallback and reset the silence window');

    socket.emitClosed();
    assertDeepEqual([
        provider.isConnected(),
        provider.selectPollTickers(tickers).map(ticker => ticker.symbol),
        stale,
        provider._reconnectTimeoutId !== 0,
        socket.closeCalls,
    ], [false, ['btcusd'], [['btcusd']], true, 1],
    'A closed transport should restore fallback, mark stale, close, and arm reconnect');
    provider.stop();
}

async function testHyperliquidLivePipeline() {
    const tickers = [
        cryptoTicker('purrusdc', 'PURR/USDC', CRYPTO_PROVIDERS.HYPERLIQUID),
        cryptoTicker('btc', 'BTC', CRYPTO_PROVIDERS.HYPERLIQUID),
    ];
    const {provider, socket, updates} = await startProvider(HyperliquidProvider, tickers);

    socket.emitText({
        channel: 'subscriptionResponse',
        data: {method: 'subscribe', subscription: {type: 'activeAssetCtx', coin: 'PURR/USDC'}},
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
    assertDeepEqual(provider.selectPollTickers(tickers).map(ticker => ticker.symbol), ['btc'],
        'Fallback should remain active for each unacknowledged Hyperliquid symbol');
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
    provider.updateSubscriptions([cryptoTicker('btcusd', 'BTC/USD')]);
    provider.updateSubscriptions([cryptoTicker('btcusd', 'BTC/USD')]);
    provider.updateSubscriptions([cryptoTicker('ethusd', 'ETH/USD')]);
    assertDeepEqual([attempts.length, attempts[0].cancellable.is_cancelled()], [2, true],
        'Repeated subscriptions should share a handshake while changed symbols replace it');

    const staleSocket = new FakeWebsocket();
    const activeSocket = new FakeWebsocket();
    attempts[0].resolve(staleSocket);
    attempts[1].resolve(activeSocket);
    await flushPromises();
    assertDeepEqual([staleSocket.closeCalls, provider.isConnected()], [1, true],
        'Only the current handshake should be adopted; a stale completion should close');

    provider.updateSubscriptions([cryptoTicker('solusd', 'SOL/USD')]);
    provider.stop();
    const stoppedSocket = new FakeWebsocket();
    attempts[2].resolve(stoppedSocket);
    await flushPromises();
    assertDeepEqual([activeSocket.closeCalls, stoppedSocket.closeCalls, provider.isConnected()], [1, 1, false],
        'Resubscription and stop should close active and late sockets without resurrection');
}

async function testKrakenSymbolRejectionIsolation() {
    const stale = [];
    const diagnostics = [];
    const fallbacks = [];
    const tickers = [
        cryptoTicker('btcusd', 'BTC/USD'),
        cryptoTicker('invalidusd', 'NOTAREALPAIR/USD'),
    ];
    const {provider, socket, updates} = await startProvider(KrakenProvider, tickers, {
        onStale: staleTickers => stale.push(staleTickers.map(ticker => ticker.symbol)),
    });

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
        const wildcardRejection = {error: 'Subscription rejected', method: 'subscribe', success: false};
        socket.emitText(wildcardRejection);
        socket.emitText({
            channel: 'ticker',
            data: [{
                symbol: 'BTC/USD',
                last: '100',
                timestamp: '2026-03-22T12:34:56.789Z',
                change: '5',
            }],
        });
        fallbacks.push(provider.selectPollTickers(tickers).map(ticker => ticker.symbol));
        socket.emitText(wildcardRejection);
        socket.emitText({
            method: 'subscribe',
            success: true,
            result: {channel: 'ticker', symbol: 'BTC/USD'},
        });
        fallbacks.push(provider.selectPollTickers(tickers).map(ticker => ticker.symbol));
    } finally {
        globalThis.log = originalLog;
    }

    assertDeepEqual(stale, [
        ['invalidusd'],
        ['invalidusd'],
        ['btcusd', 'invalidusd'],
        ['btcusd', 'invalidusd'],
    ], 'Kraken should isolate symbol rejections while marking all tickers stale for wildcard failures');
    assertEqual(diagnostics.length, 4,
        'Duplicate symbol rejections should be deduplicated while new wildcard epochs remain reportable');
    assertEqual(socket.closeCalls, 0,
        'A symbol rejection should not reconnect an otherwise healthy shared socket');
    assertDeepEqual(fallbacks, [['invalidusd'], ['invalidusd']],
        'Valid quotes and acknowledgements should each clear wildcard REST fallback');
    assertDeepEqual(updates, [[
        ['BTCUSD', {price: 100, previousClose: 95}],
    ]], 'Valid Kraken traffic should continue after another symbol is rejected');
    provider.stop();
}

async function startProvider(Provider, tickers, options = {}) {
    const socket = new FakeWebsocket();
    const updates = [];
    const provider = new Provider({
        uuid: 'test',
        connectWebsocket: async () => socket,
        onQuotes: quotes => updates.push(projectQuotes(quotes)),
        onStale() {},
        ...options,
    });
    provider.start({});
    provider.updateSubscriptions(tickers);
    await flushPromises();
    return {provider, socket, updates};
}

function cryptoTicker(symbol, liveSymbol, cryptoProvider = CRYPTO_PROVIDERS.KRAKEN) {
    return {symbol, liveSymbol, assetCategory: ASSET_CATEGORIES.CRYPTO, cryptoProvider};
}

function projectQuotes(quotes) {
    return Array.from(quotes, ([symbol, {price, previousClose}]) => [symbol, {price, previousClose}]);
}

class FakeWebsocket {
    constructor() {
        this.handlers = new Map();
        this.nextSignalId = 1;
        this.sentTexts = [];
        this.closeCalls = 0;
    }

    connect(signal, handler) {
        const signalId = this.nextSignalId++;
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
        const bytes = {get_data: () => new TextEncoder().encode(JSON.stringify(payload))};
        this._emit('message', Soup.WebsocketDataType.TEXT, bytes);
    }

    emitClosed() {
        this._emit('closed');
    }

    _emit(expectedSignal, ...args) {
        for (const {signal, handler} of this.handlers.values()) {
            if (signal === expectedSignal)
                handler(this, ...args);
        }
    }
}

async function flushPromises() {
    await Promise.resolve();
}
