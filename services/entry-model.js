import {
    createDisplayEntry,
    createErrorEntry,
    createLoadingEntry,
    NEGATIVE_COLOR,
    POSITIVE_COLOR,
} from '../utils/format.js';

/*
 * This module translates QuoteStore state into loading, error, and display entries.
 * It decorates price changes; staleness is whatever the store recorded, so market
 * hours are never consulted here.
 */
export function buildEntries(tickers, quoteStore, displaySettings, previousEntries = []) {
    const baseEntries = tickers.map((ticker, index) => {
        const quote = quoteStore.getQuote(ticker.symbol);

        if (!quote && !quoteStore.isStale(ticker.symbol))
            return createLoadingEntry(ticker, index, displaySettings);

        if (!quote)
            return createErrorEntry(ticker, index, displaySettings);

        return createDisplayEntry(ticker, quote, quote.previousClose, index, displaySettings, {
            isStale: quoteStore.isStale(ticker.symbol),
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
    const previousEntriesBySymbol = new Map(
        previousEntries.map(entry => [entry.symbol?.toUpperCase() ?? entry.label, entry])
    );

    return entries.map(entry => {
        const previousEntry = previousEntriesBySymbol.get(entry.symbol?.toUpperCase() ?? entry.label);
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
