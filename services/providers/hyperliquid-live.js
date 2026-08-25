import {CRYPTO_PROVIDERS} from '../../utils/asset-categories.js';
import {
    fetchHyperliquidMarketSnapshots,
    HYPERLIQUID_WEBSOCKET_URL,
} from '../../utils/crypto-providers/hyperliquid/catalog.js';
import {createHyperliquidQuote} from '../../utils/crypto-providers/hyperliquid/quotes.js';
import {normalizeHyperliquidLiveSymbol} from '../../utils/crypto-providers/hyperliquid/symbols.js';
import {LiveWebsocketProvider} from './live-websocket-provider.js';

/*
 * HyperliquidProvider supplies REST snapshots and protocol hooks to the shared websocket lifecycle.
 */
export class HyperliquidProvider extends LiveWebsocketProvider {
    constructor(options) {
        super({
            ...options,
            id: CRYPTO_PROVIDERS.HYPERLIQUID,
            name: 'Hyperliquid',
            websocketUrl: HYPERLIQUID_WEBSOCKET_URL,
        });
    }

    async poll(tickers, {session}) {
        if (!session || tickers.length === 0) return new Map();

        const markets = await fetchHyperliquidMarketSnapshots(session);
        const marketsBySymbol = new Map(markets.map(entry => [entry.liveSymbol, entry]));
        const quotesBySymbol = new Map();

        tickers.forEach(ticker => {
            const quote = createHyperliquidQuote(marketsBySymbol.get(ticker.liveSymbol));
            if (quote) quotesBySymbol.set(ticker.symbol.toUpperCase(), quote);
        });

        return quotesBySymbol;
    }

    _subscribe(websocket, symbols) {
        symbols.forEach(coin => websocket.send_text(JSON.stringify({
            method: 'subscribe',
            subscription: {type: 'activeAssetCtx', coin},
        })));
    }

    _handlePayload(payload) {
        if (payload?.channel !== 'activeAssetCtx' || !payload?.data?.coin || !payload?.data?.ctx) return null;

        const liveSymbol = normalizeHyperliquidLiveSymbol(payload.data.coin);
        const tickerSymbol = this._getSymbolToTickerSymbolMap().get(liveSymbol);
        if (!tickerSymbol) return null;

        const quote = createHyperliquidQuote({ctx: payload.data.ctx});

        if (!quote) return null;

        return {readySymbols: [liveSymbol], quotesBySymbol: new Map([[tickerSymbol, quote]])};
    }
}
