import {CRYPTO_PROVIDERS} from '../../utils/asset-categories.js';
import {krakenAdapter} from '../../utils/crypto-providers/index.js';
import {LiveWebsocketProvider} from './live-websocket-provider.js';

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
            websocketUrl: krakenAdapter.websocketUrl,
        });
        this._reportedRejectedSymbols = new Set();
    }

    stop() {
        this._reportedRejectedSymbols.clear();
        super.stop();
    }

    /* Rejection warnings follow active subscriptions, so removed pairs cannot leave diagnostic state behind. */
    updateSubscriptions(tickers) {
        const previousSignature = [...this._getDesiredSymbols()].sort().join('|');
        super.updateSubscriptions(tickers);

        const desiredSymbols = new Set(this._getDesiredSymbols());
        [...this._reportedRejectedSymbols]
            .filter(symbol => symbol !== '*' && !desiredSymbols.has(symbol))
            .forEach(symbol => this._reportedRejectedSymbols.delete(symbol));

        if ([...desiredSymbols].sort().join('|') !== previousSignature)
            this._reportedRejectedSymbols.delete('*');
    }

    /* Kraken's REST endpoint accepts the same live symbols used by its websocket. */
    async poll(tickers, {session}) {
        if (!session || tickers.length === 0) return new Map();

        const quotesByPair = await krakenAdapter.fetchTickerQuotes(
            session, [...new Set(tickers.map(ticker => ticker.liveSymbol))]);
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
            const warningKey = rejectedSymbol === '' ? '*' : rejectedSymbol;
            this._reportRejectedSubscription(warningKey, rejectedSymbol, payload.error);

            /* Kraken acknowledges each pair independently, so valid subscriptions keep their live transport. */
            return {staleTickers};
        }

        if (
            payload?.method === 'subscribe' &&
            payload?.success === true &&
            payload?.result?.channel === 'ticker'
        ) {
            this._clearAcknowledgedRejections(payload.result.symbol);
            const readySymbols = Array.isArray(payload.result.symbol)
                ? payload.result.symbol
                : [payload.result.symbol];
            return {readySymbols};
        }

        if (payload?.channel !== 'ticker' || !Array.isArray(payload.data)) return null;

        const updatedQuotes = new Map();
        const readySymbols = [];
        const liveSymbolMap = this._getSymbolToTickerSymbolMap();

        payload.data.forEach(entry => {
            const tickerSymbol = liveSymbolMap.get(entry?.symbol ?? '');
            const quote = krakenAdapter.createQuote(entry);

            if (!tickerSymbol || !quote)
                return;

            this._clearAcknowledgedRejections(entry.symbol);
            readySymbols.push(entry.symbol);
            updatedQuotes.set(tickerSymbol, quote);
        });

        return {readySymbols, quotesBySymbol: updatedQuotes};
    }

    /* One bad pair produces one actionable warning until that pair later acknowledges or returns data. */
    _reportRejectedSubscription(warningKey, rejectedSymbol, errorMessage) {
        if (this._reportedRejectedSymbols.has(warningKey))
            return;

        this._reportedRejectedSymbols.add(warningKey);
        const symbolMessage = rejectedSymbol === '' ? 'one or more symbols' : rejectedSymbol;
        const reason = `${errorMessage ?? 'subscription rejected'}`.trim();
        log(`${this._uuid}: Kraken rejected ${symbolMessage}: ${reason}`);
    }

    _clearAcknowledgedRejections(symbols) {
        const acknowledgedSymbols = Array.isArray(symbols) ? ['*', ...symbols] : ['*', symbols];
        acknowledgedSymbols.filter(Boolean).forEach(symbol => this._reportedRejectedSymbols.delete(symbol));
    }
}
