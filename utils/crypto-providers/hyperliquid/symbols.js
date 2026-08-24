import {normalizeCompactProviderSymbol, normalizeProviderSearchQuery} from '../shared.js';

/* Provider/live symbols are normalized here so prefs, providers, and storage agree on one symbol shape. */
export function normalizeHyperliquidLiveSymbol(value) {
    return normalizeCompactProviderSymbol(value, /^[A-Z0-9]+(?:\/[A-Z0-9]+)?$/);
}

/* Saved ticker symbols are provider-neutral lowercase ids derived from Hyperliquid live symbols here. */
export function normalizeHyperliquidTickerSymbol(value) {
    return normalizeHyperliquidLiveSymbol(value)
        .replace(/[^A-Z0-9]/g, '')
        .toLowerCase();
}

/* Spot/perp branching elsewhere uses this helper instead of repeating string-shape checks inline. */
export function isHyperliquidSpotSymbol(value) {
    return normalizeHyperliquidLiveSymbol(value).includes('/');
}

/* Search scoring encodes Hyperliquid-specific matching priorities for the prefs dialog. */
export function scoreHyperliquidCatalogEntry(entry, query) {
    const normalizedQuery = normalizeHyperliquidSearchQuery(query);
    if (normalizedQuery === '') return Number.NEGATIVE_INFINITY;

    const normalizedLabel = normalizeHyperliquidSearchQuery(entry.label);
    const normalizedSymbol = normalizeHyperliquidSearchQuery(entry.symbol);
    const normalizedLiveSymbol = normalizeHyperliquidSearchQuery(entry.liveSymbol);
    const normalizedBase = normalizeHyperliquidSearchQuery(entry.base);
    const normalizedQuote = normalizeHyperliquidSearchQuery(entry.quote);
    const normalizedKeywords = (entry.keywords ?? []).map(keyword => normalizeHyperliquidSearchQuery(keyword));
    const marketTypeBias = entry.hyperliquidMarketType === 'perp' ? 20 : 0;

    let score = -1;

    if (normalizedLiveSymbol === normalizedQuery)
        score = Math.max(score, 950);

    if (normalizedSymbol === normalizedQuery)
        score = Math.max(score, 900);

    if (normalizedBase === normalizedQuery)
        score = Math.max(score, 860 + marketTypeBias);

    if (normalizedLabel === normalizedQuery)
        score = Math.max(score, 820);

    if (normalizedKeywords.some(keyword => keyword === normalizedQuery))
        score = Math.max(score, 760);

    if (normalizedBase.startsWith(normalizedQuery))
        score = Math.max(score, 720 + marketTypeBias);

    if (normalizedLiveSymbol.startsWith(normalizedQuery))
        score = Math.max(score, 690);

    if (normalizedSymbol.startsWith(normalizedQuery))
        score = Math.max(score, 660);

    if (
        normalizedLabel.startsWith(normalizedQuery) ||
        normalizedKeywords.some(keyword => keyword.startsWith(normalizedQuery))
    )
        score = Math.max(score, 620);

    if (
        normalizedLiveSymbol.includes(normalizedQuery) ||
        normalizedSymbol.includes(normalizedQuery) ||
        normalizedBase.includes(normalizedQuery) ||
        normalizedQuote.includes(normalizedQuery) ||
        normalizedLabel.includes(normalizedQuery) ||
        normalizedKeywords.some(keyword => keyword.includes(normalizedQuery))
    )
        score = Math.max(score, 500);

    return score;
}

/* Search normalization strips formatting noise so catalog ranking compares provider values consistently. */
function normalizeHyperliquidSearchQuery(value) {
    return normalizeProviderSearchQuery(value);
}
