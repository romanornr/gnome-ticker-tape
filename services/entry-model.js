import {
    createDisplayEntry,
    createErrorEntry,
    createLoadingEntry,
    NEGATIVE_COLOR,
    POSITIVE_COLOR,
} from '../utils/format.js';

/* QuoteStore state becomes loading, error, and display entries; market policy stays upstream. */
export function buildEntries(tickers, quoteStore, displaySettings, previousEntries = []) {
    const baseEntries = tickers.map((ticker, index) => {
        const {quote, stale} = quoteStore.getState(ticker.symbol);

        if (!quote && !stale)
            return createLoadingEntry(ticker, index, displaySettings);

        if (!quote)
            return createErrorEntry(ticker, index, displaySettings);

        return createDisplayEntry(ticker, quote, quote.previousClose, index, displaySettings, {
            isStale: stale,
        });
    });

    return decorateEntriesWithPriceFlash(baseEntries, previousEntries);
}

/* After the temporary flash window expires, entries return to the theme's inherited text color. */
export function clearPriceFlash(entries) {
    return entries.map(entry => ({
        ...entry,
        priceColor: null,
        priceFlash: false,
    }));
}

/* Price flash compares the new view-model to the previous render, not to raw quotes. */
function decorateEntriesWithPriceFlash(entries, previousEntries) {
    const previousEntriesBySymbol = new Map(previousEntries.map(entry => [entry.symbol.toUpperCase(), entry]));

    return entries.map(entry => {
        const previousEntry = previousEntriesBySymbol.get(entry.symbol.toUpperCase());
        const previousPrice = previousEntry?.displayPrice;

        if (
            entry.isStale ||
            !previousEntry ||
            !Number.isFinite(previousPrice) ||
            !Number.isFinite(entry.displayPrice) ||
            previousEntry.priceText === entry.priceText
        )
            return entry;

        return {
            ...entry,
            priceColor: entry.displayPrice > previousPrice ? POSITIVE_COLOR : NEGATIVE_COLOR,
            priceFlash: true,
        };
    });
}
