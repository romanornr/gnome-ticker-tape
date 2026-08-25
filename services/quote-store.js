import GLib from 'gi://GLib';

/* QuoteStore keeps each symbol's quote, refresh cadence, and stale state together. */
export class QuoteStore {
    constructor() {
        this._stateBySymbol = new Map();
    }

    getState(symbol) {
        return this._stateBySymbol.get(normalizeSymbol(symbol)) ?? {
            quote: null,
            lastRefreshUsec: 0,
            stale: false,
        };
    }

    /* Live updates replace quote data without changing the REST polling cadence. */
    mergeQuotes(quotesBySymbol) {
        quotesBySymbol.forEach((quote, symbol) => this._setQuote(normalizeSymbol(symbol), quote));
    }

    /* A completed poll records quote hits and misses as one state transition. */
    recordPoll(tickers, quotesBySymbol) {
        const refreshedAtUsec = GLib.get_monotonic_time();
        const normalizedQuotes = new Map();
        quotesBySymbol.forEach((quote, symbol) => normalizedQuotes.set(normalizeSymbol(symbol), quote));

        tickers.forEach(ticker => {
            const symbol = normalizeSymbol(ticker.symbol);
            const quote = normalizedQuotes.get(symbol);
            if (quote)
                this._setQuote(symbol, quote, refreshedAtUsec);
            else
                this._stateBySymbol.set(symbol, {...this.getState(symbol), stale: true});
        });
    }

    markStale(tickers) {
        tickers.forEach(ticker => {
            const symbol = normalizeSymbol(ticker.symbol);
            this._stateBySymbol.set(symbol, {...this.getState(symbol), stale: true});
        });
    }

    prune(tickers) {
        const activeSymbols = new Set(tickers.map(ticker => normalizeSymbol(ticker.symbol)));
        for (const symbol of this._stateBySymbol.keys()) {
            if (!activeSymbols.has(symbol))
                this._stateBySymbol.delete(symbol);
        }
    }

    /* A missing previous close carries forward only within the same provider date. */
    _setQuote(symbol, quote, refreshedAtUsec = null) {
        const state = this.getState(symbol);
        const previousClose = quote.previousClose === null && state.quote?.quoteDate === quote.quoteDate
            ? state.quote.previousClose ?? null
            : quote.previousClose;
        this._stateBySymbol.set(symbol, {
            quote: {...quote, previousClose},
            lastRefreshUsec: refreshedAtUsec ?? state.lastRefreshUsec,
            stale: false,
        });
    }
}

function normalizeSymbol(symbol) {
    return symbol.trim().toUpperCase();
}
