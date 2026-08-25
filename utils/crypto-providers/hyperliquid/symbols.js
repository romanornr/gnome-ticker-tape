export function normalizeHyperliquidLiveSymbol(value) {
    const symbol = `${value ?? ''}`.trim().toUpperCase().replace(/\s+/g, '');
    return /^[A-Z0-9]+$/.test(symbol) ? symbol : '';
}

export function normalizeHyperliquidTickerSymbol(value) {
    return normalizeHyperliquidLiveSymbol(value).toLowerCase();
}
