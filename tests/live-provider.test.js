import Soup from 'gi://Soup?version=3.0';

import {KrakenProvider} from '../providers/kraken/provider.js';
import {ASSET_CATEGORIES, CRYPTO_PROVIDERS} from '../utils/asset-categories.js';
import {assertDeepEqual} from './support/assert.js';

export async function runTests() {
    const ticker = {
        symbol: 'btcusd',
        liveSymbol: 'BTC/USD',
        assetCategory: ASSET_CATEGORIES.CRYPTO,
        cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
    };
    const socket = new FakeWebsocket();
    const updates = [];
    const provider = new KrakenProvider({
        uuid: 'test',
        connectWebsocket: async () => socket,
        onQuotes: quotes => updates.push(Array.from(quotes)),
        onStale() {},
    });
    provider.start({});
    provider.updateSubscriptions([ticker]);
    await Promise.resolve();

    const fallbackSymbols = () =>
        provider.selectPollTickers([ticker]).map(item => item.symbol);
    const fallbacks = [fallbackSymbols()];
    socket.emitText({
        method: 'subscribe',
        success: true,
        result: {channel: 'ticker', symbol: 'BTC/USD'},
    });
    fallbacks.push(fallbackSymbols());
    socket.emitText({
        channel: 'ticker',
        data: [{symbol: 'BTC/USD', last: '104321.5', timestamp: 1787659200}],
    });
    fallbacks.push(fallbackSymbols());
    socket.emitText({
        channel: 'ticker',
        data: [{symbol: 'BTC/USD', last: '0', timestamp: '2026-08-25T12:00:00Z'}],
    });
    fallbacks.push(fallbackSymbols());
    socket.emitText({
        channel: 'ticker',
        data: [{
            symbol: 'BTC/USD',
            last: '104321.5',
            timestamp: '2026-08-25T12:00:00Z',
            change: '-100',
        }],
    });
    fallbacks.push(fallbackSymbols());

    assertDeepEqual({
        fallbacks,
        subscription: JSON.parse(socket.sentTexts[0]).params.symbol,
        update: updates.map(batch => batch.map(([symbol, quote]) =>
            [symbol, quote.price, quote.previousClose])),
    }, {
        fallbacks: [['btcusd'], ['btcusd'], ['btcusd'], ['btcusd'], []],
        subscription: ['BTC/USD'],
        update: [[['BTCUSD', 104321.5, 104421.5]]],
    }, 'WebSocket readiness should require a valid quote, not connection or acknowledgement');
    provider.stop();
}

class FakeWebsocket {
    constructor() {
        this.handlers = new Map();
        this.sentTexts = [];
        this.nextSignalId = 1;
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

    close() {}

    emitText(payload) {
        const bytes = {get_data: () => new TextEncoder().encode(JSON.stringify(payload))};
        for (const {signal, handler} of this.handlers.values()) {
            if (signal === 'message')
                handler(this, Soup.WebsocketDataType.TEXT, bytes);
        }
    }
}
