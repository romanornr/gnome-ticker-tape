export function normalizeKrakenLiveSymbol(value) {
    const symbol = `${value ?? ''}`.trim().toUpperCase().replace(/\s+/g, '');
    return /^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol) ? symbol : '';
}

export function normalizeKrakenTickerSymbol(value) {
    return normalizeKrakenLiveSymbol(value).replace('/', '').toLowerCase();
}
