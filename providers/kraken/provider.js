import {CRYPTO_PROVIDERS} from '../../utils/asset-categories.js';
import {KRAKEN_WEBSOCKET_URL} from './catalog.js';
import {createKrakenQuote, parseKrakenTickerQuotes} from './quotes.js';
import {httpGetJson} from '../http.js';
import {LiveWebsocketProvider} from '../live-websocket-provider.js';

const KRAKEN_REST_TICKER_URL = 'https://api.kraken.com/0/public/Ticker';

/*
 * KrakenProvider owns polling and websocket protocol messages.
 * LiveWebsocketProvider supplies routing, lifecycle, reconnect, and stale notification.
 */
export class KrakenProvider extends LiveWebsocketProvider {
    constructor(options) {
        super({
            ...options,
            id: CRYPTO_PROVIDERS.KRAKEN,
            name: 'Kraken',
            websocketUrl: KRAKEN_WEBSOCKET_URL,
        });
        this._rejectionReported = false;
    }

    /* Kraken's REST endpoint accepts the same live symbols used by its websocket. */
    async poll(tickers, {session}) {
        if (!session || tickers.length === 0) return new Map();

        const liveSymbols = [...new Set(tickers.map(ticker => ticker.liveSymbol))];
        const url = `${KRAKEN_REST_TICKER_URL}?pair=${liveSymbols.map(encodeURIComponent).join(',')}`;
        const quotesByPair = parseKrakenTickerQuotes(await httpGetJson(session, url));
        const quotesBySymbol = new Map();

        tickers.forEach(ticker => {
            const quote = quotesByPair.get(ticker.liveSymbol);
            if (quote) quotesBySymbol.set(ticker.symbol.toUpperCase(), quote);
        });

        return quotesBySymbol;
    }

    /* Kraken uses one subscribe request containing the full symbol list. */
    _subscribe(websocket, symbols) {
        websocket.send_text(JSON.stringify({
            method: 'subscribe',
            params: {
                channel: 'ticker',
                event_trigger: 'trades',
                symbol: symbols,
                snapshot: true,
            },
        }));
    }

    /* Kraken payloads are converted here into the normalized quote map expected by QuotesService. */
    _handlePayload(payload) {
        if (payload?.success === false) {
            const rejectedSymbol = `${payload.symbol ?? ''}`.trim();
            const staleTickers = rejectedSymbol === ''
                ? this._tickers
                : this._tickers.filter(ticker => ticker.liveSymbol === rejectedSymbol);
            this._reportRejectedSubscription(rejectedSymbol, payload.error);

            /* Kraken acknowledges each pair independently, so valid subscriptions keep their live transport. */
            return {staleTickers};
        }

        if (payload?.channel !== 'ticker' || !Array.isArray(payload.data)) return null;

        const updatedQuotes = new Map();
        const readySymbols = [];
        const liveSymbolMap = this._getSymbolToTickerSymbolMap();

        payload.data.forEach(entry => {
            const tickerSymbol = liveSymbolMap.get(entry?.symbol ?? '');
            const quote = createKrakenQuote(entry);

            if (!tickerSymbol || !quote)
                return;

            readySymbols.push(entry.symbol);
            updatedQuotes.set(tickerSymbol, quote);
        });

        if (updatedQuotes.size > 0)
            this._rejectionReported = false;

        return {readySymbols, quotesBySymbol: updatedQuotes};
    }

    /* One warning covers a rejection streak until valid quote traffic proves recovery. */
    _reportRejectedSubscription(rejectedSymbol, errorMessage) {
        if (this._rejectionReported)
            return;

        this._rejectionReported = true;
        const symbolMessage = rejectedSymbol === '' ? 'one or more symbols' : rejectedSymbol;
        const reason = `${errorMessage ?? 'subscription rejected'}`.trim();
        log(`${this._uuid}: Kraken rejected ${symbolMessage}: ${reason}`);
    }
}
