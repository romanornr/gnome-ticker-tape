/* Provider quote objects are normalized here so both REST and websocket paths emit the same shape. */
export function createHyperliquidQuote(entry) {
    const price = firstPositiveNumber(entry?.ctx?.midPx, entry?.ctx?.markPx);
    if (price === null) return null;

    const previousClose = Number.parseFloat(`${entry?.ctx?.prevDayPx ?? ''}`);
    return {
        price,
        quoteDate: getCurrentUtcDate(),
        previousClose: Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null,
    };
}

function firstPositiveNumber(...values) {
    for (const value of values) {
        const parsed = Number.parseFloat(`${value ?? ''}`);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    return null;
}

/* Hyperliquid omits a quote timestamp, so cache dates use the current UTC day. */
function getCurrentUtcDate() {
    return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}
