import {CRYPTO_PROVIDERS} from '../../utils/asset-categories.js';
import {hyperliquidAdapter} from '../../utils/crypto-providers/index.js';
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
            websocketUrl: hyperliquidAdapter.websocketUrl,
        });
    }

    async poll(tickers, {session}) {
        if (!session || tickers.length === 0) return new Map();

        const snapshots = await hyperliquidAdapter.fetchMarketSnapshots(session);
        const perpsBySymbol = new Map(snapshots.perps.map(entry => [entry.liveSymbol, entry]));
        const spotsBySymbol = new Map(snapshots.spots.map(entry => [entry.liveSymbol, entry]));
        const quotesBySymbol = new Map();

        tickers.forEach(ticker => {
            const entries = ticker.liveSymbol.includes('/') ? spotsBySymbol : perpsBySymbol;
            const quote = hyperliquidAdapter.createQuote(entries.get(ticker.liveSymbol));
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
        if (
            payload?.channel === 'subscriptionResponse' &&
            payload?.data?.method === 'subscribe' &&
            payload?.data?.subscription?.type === 'activeAssetCtx'
        ) {
            const liveSymbol = hyperliquidAdapter.normalizeLiveSymbol(payload.data.subscription.coin);
            return this._getSymbolToTickerSymbolMap().has(liveSymbol) ? {readySymbols: [liveSymbol]} : null;
        }

        if (payload?.channel !== 'activeAssetCtx' || !payload?.data?.coin || !payload?.data?.ctx) return null;

        const liveSymbol = hyperliquidAdapter.normalizeLiveSymbol(payload.data.coin);
        const tickerSymbol = this._getSymbolToTickerSymbolMap().get(liveSymbol);
        if (!tickerSymbol) return null;

        const quote = hyperliquidAdapter.createQuote({liveSymbol, ctx: payload.data.ctx});

        if (!quote) return null;

        return {readySymbols: [liveSymbol], quotesBySymbol: new Map([[tickerSymbol, quote]])};
    }
}
