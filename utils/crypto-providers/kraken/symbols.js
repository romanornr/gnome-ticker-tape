import {normalizeProviderSearchQuery, normalizeCompactProviderSymbol} from '../shared.js';

const KRAKEN_SPOT_PAIR_QUOTE_PRIORITY = ['USD', 'EUR', 'USDT', 'USDC', 'BTC', 'ETH'];

/* Kraken websocket pair symbols are normalized here so all layers compare the same live identifier. */
export function normalizeKrakenLiveSymbol(value) {
    return normalizeCompactProviderSymbol(value, /^[A-Z0-9]+\/[A-Z0-9]+$/);
}

/* Saved ticker ids for Kraken are consistently derived from the websocket pair symbol here. */
export function normalizeKrakenTickerSymbol(value) {
    return normalizeKrakenLiveSymbol(value).replace('/', '').toLowerCase();
}

/* Search scoring prefers strong Kraken pair matches while still supporting fuzzy asset/pair queries. */
export function scoreKrakenCatalogEntry(entry, query) {
    const normalizedQuery = normalizeKrakenSearchQuery(query);
    if (normalizedQuery === '') return Number.NEGATIVE_INFINITY;

    const normalizedLiveSymbol = normalizeKrakenSearchQuery(entry.liveSymbol);
    const normalizedCompactSymbol = normalizeKrakenSearchQuery(entry.symbol);
    const normalizedBase = normalizeKrakenSearchQuery(entry.base);
    const normalizedLabel = normalizeKrakenSearchQuery(entry.label);
    const normalizedQuote = normalizeKrakenSearchQuery(entry.quote);

    let score = -1;

    if (normalizedBase === normalizedQuery)
        score = Math.max(score, 700 - getKrakenQuotePriority(entry.quote));

    if (normalizedLiveSymbol === normalizedQuery)
        score = Math.max(score, 900);

    if (normalizedCompactSymbol === normalizedQuery)
        score = Math.max(score, 850);

    if (normalizedLabel === normalizedQuery)
        score = Math.max(score, 800);

    if (normalizedBase.startsWith(normalizedQuery))
        score = Math.max(score, 650 - getKrakenQuotePriority(entry.quote));

    if (normalizedLiveSymbol.startsWith(normalizedQuery))
        score = Math.max(score, 600 - getKrakenQuotePriority(entry.quote));

    if (normalizedCompactSymbol.startsWith(normalizedQuery))
        score = Math.max(score, 580 - getKrakenQuotePriority(entry.quote));

    if (
        normalizedLiveSymbol.includes(normalizedQuery) ||
        normalizedCompactSymbol.includes(normalizedQuery) ||
        normalizedBase.includes(normalizedQuery) ||
        normalizedQuote.includes(normalizedQuery)
    )
        score = Math.max(score, 500 - getKrakenQuotePriority(entry.quote));

    return score;
}

/* Quote-priority is a search/ranking signal, not a market-data value. */
function getKrakenQuotePriority(quote) {
    const index = KRAKEN_SPOT_PAIR_QUOTE_PRIORITY.indexOf(`${quote ?? ''}`.trim().toUpperCase());
    return index === -1 ? KRAKEN_SPOT_PAIR_QUOTE_PRIORITY.length : index;
}

/* Search normalization makes Kraken labels, compact symbols, and pair strings comparable. */
function normalizeKrakenSearchQuery(value) {
    return normalizeProviderSearchQuery(value);
}
