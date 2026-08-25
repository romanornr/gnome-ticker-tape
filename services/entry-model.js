import {
    createDisplayEntry,
    createErrorEntry,
    createLoadingEntry,
    NEGATIVE_COLOR,
    POSITIVE_COLOR,
} from '../utils/format.js';

/* QuoteStore state becomes one panel entry per saved ticker, including duplicates. */
export function buildEntries(tickers, quoteStore, previousEntries = []) {
    const entries = tickers.map(ticker => {
        const {quote, stale} = quoteStore.getState(ticker.symbol);

        if (!quote && !stale)
            return createLoadingEntry(ticker);

        if (!quote)
            return createErrorEntry(ticker);

        return createDisplayEntry(ticker, quote, {isStale: stale});
    });

    return decorateEntriesWithPriceFlash(entries, previousEntries);
}

/* After the temporary flash window expires, entries return to the theme's inherited text color. */
export function clearPriceFlash(entries) {
    return entries.map(entry => ({
        ...entry,
        priceColor: null,
        priceFlash: false,
    }));
}

function decorateEntriesWithPriceFlash(entries, previousEntries) {
    return entries.map((entry, index) => {
        const previousEntry = previousEntries[index];
        const previousPrice = previousEntry?.displayPrice;

        if (
            entry.isStale ||
            !previousEntry ||
            previousEntry.symbol !== entry.symbol ||
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
