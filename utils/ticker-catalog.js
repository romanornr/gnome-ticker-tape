import {ASSET_CATEGORIES, CRYPTO_PROVIDERS} from './asset-categories.js';
import {MAINLAND_CHINA_EQUITY_TICKERS} from './catalog/mainland-china-equity.js';
import {COMMODITY_TICKERS} from './catalog/commodity.js';
import {FX_TICKERS} from './catalog/fx.js';
import {GERMANY_EQUITY_TICKERS} from './catalog/germany-equity.js';
import {HONG_KONG_EQUITY_TICKERS} from './catalog/hong-kong-equity.js';
import {JAPAN_EQUITY_TICKERS} from './catalog/japan-equity.js';
import {NETHERLANDS_EQUITY_TICKERS} from './catalog/netherlands-equity.js';
import {UK_EQUITY_TICKERS} from './catalog/uk-equity.js';
import {US_ETF_TICKERS} from './catalog/us-etf.js';
import {US_EQUITY_TICKERS} from './catalog/us-equity.js';

const KRAKEN_QUOTE_PRIORITY = ['USD', 'EUR', 'USDT', 'USDC', 'BTC', 'ETH'];

const CATALOG = [
    ...MAINLAND_CHINA_EQUITY_TICKERS,
    ...GERMANY_EQUITY_TICKERS,
    ...HONG_KONG_EQUITY_TICKERS,
    ...JAPAN_EQUITY_TICKERS,
    ...NETHERLANDS_EQUITY_TICKERS,
    ...UK_EQUITY_TICKERS,
    ...US_EQUITY_TICKERS,
    ...US_ETF_TICKERS,
    ...COMMODITY_TICKERS,
    ...FX_TICKERS,
];

function getCuratedTickersForCategory(assetCategory) {
    return CATALOG.filter(entry => entry.assetCategory === assetCategory);
}

/* Search only intentional identity terms, using predictable exact/prefix/contains ranking. */
export function matchCuratedTickers(assetCategory, query, options = {}) {
    const normalizedQuery = `${query ?? ''}`.trim().toLowerCase();
    if (normalizedQuery === '')
        return [];

    return getCatalog(assetCategory, options)
        .map(entry => ({entry, score: scoreEntry(entry, normalizedQuery)}))
        .filter(({score}) => score > 0)
        .sort((left, right) =>
            right.score - left.score ||
            getQuotePriority(left.entry) - getQuotePriority(right.entry) ||
            left.entry.label.localeCompare(right.entry.label)
        )
        .map(({entry}) => entry);
}

function getCatalog(assetCategory, {cryptoCatalog, cryptoProvider = CRYPTO_PROVIDERS.KRAKEN}) {
    if (assetCategory !== ASSET_CATEGORIES.CRYPTO)
        return getCuratedTickersForCategory(assetCategory);

    if (!Array.isArray(cryptoCatalog))
        return [];

    return cryptoCatalog.filter(entry => entry.cryptoProvider === cryptoProvider);
}

function scoreEntry(entry, query) {
    const terms = [entry.label, entry.symbol, ...entry.keywords ?? []]
        .map(value => `${value}`.trim().toLowerCase());

    if (terms.some(term => term === query))
        return 3;
    if (terms.some(term => term.startsWith(query)))
        return 2;
    return terms.some(term => term.includes(query)) ? 1 : 0;
}

function getQuotePriority(entry) {
    if (entry.cryptoProvider !== CRYPTO_PROVIDERS.KRAKEN)
        return 0;

    const priority = KRAKEN_QUOTE_PRIORITY.indexOf(`${entry.quote ?? ''}`.toUpperCase());
    return priority === -1 ? KRAKEN_QUOTE_PRIORITY.length : priority;
}
