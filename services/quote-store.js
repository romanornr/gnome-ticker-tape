import GLib from 'gi://GLib';

/*
 * QuoteStore is the normalized in-memory boundary shared by providers and entries.
 * It owns quote merging, refresh timestamps, and stale flags.
 */
export class QuoteStore {
    /* The store keeps both quote values and refresh timestamps because scheduling depends on both. */
    constructor() {
        this._quotesBySymbol = new Map();
        this._lastRefreshTimeBySymbol = new Map();
        this._staleSymbols = new Set();
    }

    /* Providers write normalized quotes here so later layers read one stable shape. */
    setQuote(symbol, quote) {
        const normalizedSymbol = normalizeSymbol(symbol);
        if (normalizedSymbol === '' || !quote)
            return;

        const cachedPreviousClose = this._quotesBySymbol.get(normalizedSymbol)?.previousClose ?? null;
        this._quotesBySymbol.set(normalizedSymbol, {
            ...quote,
            previousClose: quote.previousClose === null ? cachedPreviousClose : quote.previousClose,
        });
        this._staleSymbols.delete(normalizedSymbol);
    }

    /* Entry-building and provider fallback logic read from the same cache through this lookup. */
    getQuote(symbol) {
        const normalizedSymbol = normalizeSymbol(symbol);
        return normalizedSymbol === '' ? null : this._quotesBySymbol.get(normalizedSymbol) ?? null;
    }

    /* When saved tickers change, stale symbols are removed here so old quotes cannot leak back into the panel. */
    prune(activeSymbols) {
        const activeSymbolSet = new Set(
            [...activeSymbols].map(symbol => normalizeSymbol(symbol)).filter(symbol => symbol !== '')
        );

        [...this._quotesBySymbol.keys()].forEach(symbol => {
            if (!activeSymbolSet.has(symbol))
                this._quotesBySymbol.delete(symbol);
        });

        [...this._lastRefreshTimeBySymbol.keys()].forEach(symbol => {
            if (!activeSymbolSet.has(symbol))
                this._lastRefreshTimeBySymbol.delete(symbol);
        });

        [...this._staleSymbols].forEach(symbol => {
            if (!activeSymbolSet.has(symbol))
                this._staleSymbols.delete(symbol);
        });
    }

    /* After a refresh succeeds, scheduling records the new monotonic refresh timestamp here. */
    markRefreshed(symbols) {
        const refreshedAtUsec = GLib.get_monotonic_time();
        [...symbols].forEach(symbol => {
            const normalizedSymbol = normalizeSymbol(symbol?.symbol ?? symbol);
            if (normalizedSymbol !== '') {
                this._lastRefreshTimeBySymbol.set(normalizedSymbol, refreshedAtUsec);
                this._staleSymbols.delete(normalizedSymbol);
            }
        });
    }

    /* Failed or incomplete attempts mark symbols stale, including cold-cache misses. */
    markStale(symbols) {
        [...symbols].forEach(symbol => {
            const normalizedSymbol = normalizeSymbol(symbol?.symbol ?? symbol);
            if (normalizedSymbol !== '')
                this._staleSymbols.add(normalizedSymbol);
        });
    }

    /* Entry-building asks this to decide whether a cached quote should render as stale. */
    isStale(symbol) {
        const normalizedSymbol = normalizeSymbol(symbol);
        return normalizedSymbol !== '' && this._staleSymbols.has(normalizedSymbol);
    }

    /* QuotesService asks for the last refresh timestamp when delegating schedule-policy decisions. */
    getLastRefreshUsec(symbol) {
        const normalizedSymbol = normalizeSymbol(symbol);
        return normalizedSymbol === '' ? 0 : this._lastRefreshTimeBySymbol.get(normalizedSymbol) ?? 0;
    }

    /* Full shutdown clears both quote values and cadence history so restart begins cleanly. */
    clear() {
        this._quotesBySymbol.clear();
        this._lastRefreshTimeBySymbol.clear();
        this._staleSymbols.clear();
    }
}

/* Symbol normalization keeps provider outputs and saved tickers keyed consistently across the system. */
function normalizeSymbol(symbol) {
    return `${symbol ?? ''}`.trim().toUpperCase();
}
