import {
    MARKET_SESSION_IDS,
    getMarketSessionIdFromLegacyMarketType,
    getMarketSessionOptions,
    hasMarketSessionId,
    isEquityMarketSessionId,
} from './market-sessions.js';

/*
 * Asset/category metadata is the shared taxonomy for the entire extension, and
 * this module also resolves which market session a ticker belongs to.
 * Catalogs, saved-config normalization, prefs, and scheduling all read that one
 * answer here rather than restating category or venue rules of their own.
 */
export const ASSET_CATEGORIES = {
    EQUITY: 'equity',
    ETF: 'etf',
    COMMODITY: 'commodity',
    FX: 'fx',
    CRYPTO: 'crypto',
};

export const CRYPTO_PROVIDERS = {
    KRAKEN: 'kraken',
    HYPERLIQUID: 'hyperliquid',
};

const CATEGORY_ORDER = [
    ASSET_CATEGORIES.EQUITY,
    ASSET_CATEGORIES.ETF,
    ASSET_CATEGORIES.COMMODITY,
    ASSET_CATEGORIES.FX,
    ASSET_CATEGORIES.CRYPTO,
];

const EQUITY_ASSET_CATEGORIES = [ASSET_CATEGORIES.EQUITY, ASSET_CATEGORIES.ETF];
const LISTING_MARKET_SESSIONS = {
    '.cn': {marketSessionId: MARKET_SESSION_IDS.CHINA_EQUITY_CASH, assetCategories: EQUITY_ASSET_CATEGORIES},
    '.de': {marketSessionId: MARKET_SESSION_IDS.EUROPE_EQUITY_CASH, assetCategories: EQUITY_ASSET_CATEGORIES},
    '.hk': {marketSessionId: MARKET_SESSION_IDS.HONG_KONG_EQUITY_CASH, assetCategories: EQUITY_ASSET_CATEGORIES},
    '.jp': {marketSessionId: MARKET_SESSION_IDS.JAPAN_EQUITY_CASH, assetCategories: EQUITY_ASSET_CATEGORIES},
    '.nl': {marketSessionId: MARKET_SESSION_IDS.EUROPE_EQUITY_CASH, assetCategories: EQUITY_ASSET_CATEGORIES},
    '.uk': {marketSessionId: MARKET_SESSION_IDS.UK_EQUITY_CASH, assetCategories: EQUITY_ASSET_CATEGORIES},
    '.us': {marketSessionId: MARKET_SESSION_IDS.US_EQUITY_EXTENDED, assetCategories: [...EQUITY_ASSET_CATEGORIES, ASSET_CATEGORIES.COMMODITY]},
};

const ASSET_CATEGORY_METADATA = {
    [ASSET_CATEGORIES.EQUITY]: {
        title: 'Equity',
        description: 'Individual stocks and major equity indexes.',
        defaultMarketSessionId: MARKET_SESSION_IDS.US_EQUITY_EXTENDED,
        searchKeywords: ['equity', 'stock', 'stocks', 'index', 'indexes'],
    },
    [ASSET_CATEGORIES.ETF]: {
        title: 'ETF',
        description: 'Exchange-traded funds that follow an equity market session.',
        defaultMarketSessionId: MARKET_SESSION_IDS.US_EQUITY_EXTENDED,
        searchKeywords: ['etf', 'etfs', 'fund', 'funds'],
    },
    [ASSET_CATEGORIES.COMMODITY]: {
        title: 'Commodity',
        description: 'Commodity markets and exchange-listed funds with instrument-specific sessions.',
        defaultMarketSessionId: MARKET_SESSION_IDS.WEEKDAY_24H,
        searchKeywords: ['commodity', 'commodities', 'metals', 'energy'],
    },
    [ASSET_CATEGORIES.FX]: {
        title: 'FX',
        description: 'Forex pairs and DXY-style currency products.',
        defaultMarketSessionId: MARKET_SESSION_IDS.WEEKDAY_24H,
        searchKeywords: ['forex', 'currency', 'currencies'],
    },
    [ASSET_CATEGORIES.CRYPTO]: {
        title: 'Crypto',
        description: 'Always-open crypto markets. Kraken is available now, with more providers planned.',
        defaultMarketSessionId: MARKET_SESSION_IDS.ALWAYS_OPEN,
        searchKeywords: ['crypto', 'cryptocurrency', 'cryptocurrencies'],
    },
};

const CRYPTO_PROVIDER_ORDER = [
    CRYPTO_PROVIDERS.KRAKEN,
    CRYPTO_PROVIDERS.HYPERLIQUID,
];

const CRYPTO_PROVIDER_METADATA = {
    [CRYPTO_PROVIDERS.KRAKEN]: {
        title: 'Kraken',
        description: 'Available now with pair search, catalog validation, and live websocket quotes.',
        available: true,
    },
    [CRYPTO_PROVIDERS.HYPERLIQUID]: {
        title: 'Hyperliquid',
        description: 'Available now with spot and perp symbol discovery plus live websocket prices.',
        available: true,
    },
};

/* prefs uses these options to keep UI labels and descriptions in sync with the shared metadata tables. */
export function getAssetCategoryOptions() {
    return CATEGORY_ORDER.map(assetCategory => {
        const metadata = ASSET_CATEGORY_METADATA[assetCategory];
        return {value: assetCategory, title: metadata.title, description: metadata.description};
    });
}

/*
 * This is the single policy seam between instrument identity and exchange schedule.
 * Listing metadata supplies venue defaults while category covers instruments without a known venue.
 */
export function getTickerMarketSessionPolicy(ticker = {}) {
    const assetCategory = ticker.assetCategory;
    const categoryMetadata = ASSET_CATEGORY_METADATA[assetCategory];
    const metadata = categoryMetadata ?? ASSET_CATEGORY_METADATA[ASSET_CATEGORIES.EQUITY];
    const defaultMarketSessionId = getListingMarketSessionId(assetCategory, ticker.symbol) ?? metadata.defaultMarketSessionId;
    const marketSessionOptions = getMarketSessionOptions();
    const allowedMarketSessionIds = !categoryMetadata
        ? marketSessionOptions.map(option => option.value)
        : EQUITY_ASSET_CATEGORIES.includes(assetCategory)
            ? marketSessionOptions.filter(option => isEquityMarketSessionId(option.value)).map(option => option.value)
            : [defaultMarketSessionId];
    const hasExplicitMarketSessionId = hasMarketSessionId(ticker.marketSessionId);
    const configuredMarketSessionId = hasExplicitMarketSessionId ? ticker.marketSessionId : getMarketSessionIdFromLegacyMarketType(ticker.marketType);
    /* Pre-catalog configs could select any session; disallowed values now deliberately follow the listing venue when known. */
    const marketSessionId = allowedMarketSessionIds.includes(configuredMarketSessionId) ? configuredMarketSessionId : defaultMarketSessionId;

    return {defaultMarketSessionId, allowedMarketSessionIds, marketSessionId};
}

/* Catalogs and shipped defaults materialize the policy default before they enter saved-config normalization. */
export function withDefaultMarketSession(ticker) {
    return {...ticker, marketSessionId: getTickerMarketSessionPolicy(ticker).defaultMarketSessionId};
}

/* prefs includes the effective value so editing can never conceal the session actually in use. */
export function getTickerMarketSessionOptions(ticker) {
    const policy = getTickerMarketSessionPolicy(ticker);
    return getMarketSessionOptions().filter(option => policy.allowedMarketSessionIds.includes(option.value));
}

/* Known provider suffixes identify listing schedules without pretending every dotted symbol is a venue. */
function getListingMarketSessionId(assetCategory, symbol) {
    const normalizedSymbol = `${symbol ?? ''}`.trim().toLowerCase();
    const listing = LISTING_MARKET_SESSIONS[normalizedSymbol.slice(normalizedSymbol.lastIndexOf('.'))];
    return listing?.assetCategories.includes(assetCategory) ? listing.marketSessionId : null;
}

/* A single default crypto provider keeps new ticker flows deterministic when the user has not chosen one yet. */
export function getDefaultCryptoProvider() {
    return CRYPTO_PROVIDERS.KRAKEN;
}

/* Runtime routing treats any crypto ticker with a live symbol as live, then optionally narrows by provider. */
export function isLiveCryptoTicker(ticker, cryptoProvider = null) {
    if (
        ticker?.assetCategory !== ASSET_CATEGORIES.CRYPTO ||
        typeof ticker.liveSymbol !== 'string' ||
        ticker.liveSymbol === ''
    )
        return false;

    return cryptoProvider === null ||
        (ticker.cryptoProvider ?? getDefaultCryptoProvider()) === cryptoProvider;
}

/* prefs uses provider options from here so the UI and runtime provider vocabulary never drift apart. */
export function getCryptoProviderOptions() {
    return CRYPTO_PROVIDER_ORDER.map(provider => {
        const metadata = CRYPTO_PROVIDER_METADATA[provider];
        return {value: provider, title: metadata.title, description: metadata.description, sensitive: metadata.available};
    });
}

/* Catalog search broadens matches with taxonomy-level words instead of only per-ticker keywords. */
export function getAssetCategorySearchTerms(assetCategory) {
    const metadata = ASSET_CATEGORY_METADATA[assetCategory];
    if (!metadata)
        return [];

    return [
        metadata.title,
        metadata.description,
        ...metadata.searchKeywords,
    ];
}
