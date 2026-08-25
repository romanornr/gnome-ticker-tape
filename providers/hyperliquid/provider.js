import {CRYPTO_PROVIDERS} from '../../utils/asset-categories.js';
import {
    fetchHyperliquidContexts,
    HYPERLIQUID_WEBSOCKET_URL,
} from './catalog.js';
import {createHyperliquidQuote} from './quotes.js';
import {normalizeHyperliquidLiveSymbol} from './symbols.js';
import {LiveWebsocketProvider} from '../live-websocket-provider.js';

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

        const contexts = await fetchHyperliquidContexts(session);
        const quotesBySymbol = new Map();

        tickers.forEach(ticker => {
            const quote = createHyperliquidQuote(contexts.get(ticker.liveSymbol));
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

        const quote = createHyperliquidQuote(payload.data.ctx);

        if (!quote) return null;

        return {readySymbols: [liveSymbol], quotesBySymbol: new Map([[tickerSymbol, quote]])};
    }
}
