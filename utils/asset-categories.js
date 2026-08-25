import {MARKET_SESSION_IDS} from './market-sessions.js';

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

const CATEGORY_TITLES = {
    [ASSET_CATEGORIES.EQUITY]: 'Equity',
    [ASSET_CATEGORIES.ETF]: 'ETF',
    [ASSET_CATEGORIES.COMMODITY]: 'Commodity',
    [ASSET_CATEGORIES.FX]: 'FX',
    [ASSET_CATEGORIES.CRYPTO]: 'Crypto',
};

const CATEGORY_SESSIONS = {
    [ASSET_CATEGORIES.EQUITY]: MARKET_SESSION_IDS.US_EQUITY_EXTENDED,
    [ASSET_CATEGORIES.ETF]: MARKET_SESSION_IDS.US_EQUITY_EXTENDED,
    [ASSET_CATEGORIES.COMMODITY]: MARKET_SESSION_IDS.WEEKDAY_24H,
    [ASSET_CATEGORIES.FX]: MARKET_SESSION_IDS.WEEKDAY_24H,
    [ASSET_CATEGORIES.CRYPTO]: MARKET_SESSION_IDS.ALWAYS_OPEN,
};

const LISTING_SESSIONS = {
    '.cn': MARKET_SESSION_IDS.CHINA_EQUITY_CASH,
    '.de': MARKET_SESSION_IDS.EUROPE_EQUITY_CASH,
    '.hk': MARKET_SESSION_IDS.HONG_KONG_EQUITY_CASH,
    '.jp': MARKET_SESSION_IDS.JAPAN_EQUITY_CASH,
    '.nl': MARKET_SESSION_IDS.EUROPE_EQUITY_CASH,
    '.uk': MARKET_SESSION_IDS.UK_EQUITY_CASH,
    '.us': MARKET_SESSION_IDS.US_EQUITY_EXTENDED,
};

export function getAssetCategoryOptions() {
    return Object.entries(CATEGORY_TITLES).map(([value, title]) => ({value, title}));
}

/* Exchange sessions are derived from category and listing suffix, never user configuration. */
export function getTickerMarketSessionId(ticker) {
    const categorySession = CATEGORY_SESSIONS[ticker.assetCategory];
    const symbol = `${ticker.symbol ?? ''}`.trim().toLowerCase();
    if (ticker.assetCategory === ASSET_CATEGORIES.COMMODITY)
        return symbol.endsWith('.us') ? MARKET_SESSION_IDS.US_EQUITY_EXTENDED : categorySession;

    if (![ASSET_CATEGORIES.EQUITY, ASSET_CATEGORIES.ETF].includes(ticker.assetCategory))
        return categorySession;

    const suffix = symbol.slice(symbol.lastIndexOf('.'));
    return LISTING_SESSIONS[suffix] ?? categorySession;
}

export function getDefaultCryptoProvider() {
    return CRYPTO_PROVIDERS.KRAKEN;
}

export function isLiveCryptoTicker(ticker, cryptoProvider = null) {
    return ticker.assetCategory === ASSET_CATEGORIES.CRYPTO &&
        ticker.liveSymbol !== '' &&
        (cryptoProvider === null || ticker.cryptoProvider === cryptoProvider);
}

export function getCryptoProviderOptions() {
    return [
        {value: CRYPTO_PROVIDERS.KRAKEN, title: 'Kraken'},
        {value: CRYPTO_PROVIDERS.HYPERLIQUID, title: 'Hyperliquid'},
    ];
}
