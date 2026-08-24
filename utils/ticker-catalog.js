import {getAssetCategorySearchTerms} from './asset-categories.js';
import {MAINLAND_CHINA_EQUITY_TICKERS} from './catalog/mainland-china-equity.js';
import {COMMODITY_TICKERS} from './catalog/commodity.js';
import {CRYPTO_TICKERS} from './catalog/crypto.js';
import {FX_TICKERS} from './catalog/fx.js';
import {GERMANY_EQUITY_TICKERS} from './catalog/germany-equity.js';
import {HONG_KONG_EQUITY_TICKERS} from './catalog/hong-kong-equity.js';
import {JAPAN_EQUITY_TICKERS} from './catalog/japan-equity.js';
import {NETHERLANDS_EQUITY_TICKERS} from './catalog/netherlands-equity.js';
import {UK_EQUITY_TICKERS} from './catalog/uk-equity.js';
import {US_ETF_TICKERS} from './catalog/us-etf.js';
import {US_EQUITY_TICKERS} from './catalog/us-equity.js';
import {ASSET_CATEGORIES, CRYPTO_PROVIDERS} from './asset-categories.js';
import {getCryptoProviderAdapter} from './crypto-providers/index.js';

/*
 * The ticker catalog is the search/lookup layer used by prefs.
 *
 * It merges curated static lists with provider-backed crypto catalogs at
 * runtime, then exposes one search/match API so the dialog controller does not
 * need to know where each candidate came from.
 */
/* Preserve block and entry order: equal-score duplicate labels use stable source order to break suggestion ties. */
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
    ...CRYPTO_TICKERS,
];

/* prefs reads category slices through this helper so callers never mutate the shared static catalog. */
export function getCuratedTickersForCategory(assetCategory) {
    return CATALOG
        .filter(entry => entry.assetCategory === assetCategory)
        .map(cloneCatalogEntry);
}

/* Exact catalog resolution converts dialog text back into a known ticker definition when possible. */
export function findCuratedTicker({label = '', symbol = '', assetCategory = ''}, options = {}) {
    const normalizedLabel = label.trim().toLowerCase();
    const normalizedSymbol = symbol.trim().toLowerCase();

    const match = getCatalogForCategory(assetCategory, options).find(entry => {
        if (assetCategory === ASSET_CATEGORIES.CRYPTO) {
            const exactSymbols = [
                entry.symbol,
                entry.liveSymbol,
                entry.label,
            ].map(value => `${value ?? ''}`.trim().toLowerCase());

            return exactSymbols.includes(normalizedSymbol) &&
                (normalizedLabel === '' || entry.label.toLowerCase() === normalizedLabel);
        }

        return entry.label.toLowerCase() === normalizedLabel &&
            entry.symbol.toLowerCase() === normalizedSymbol;
    });

    return match ? cloneCatalogEntry(match) : null;
}

/* Fuzzy matching powers the live suggestion list in prefs regardless of ticker source. */
export function matchCuratedTickers(assetCategory, query, options = {}) {
    const normalizedQuery = `${query ?? ''}`.trim().toLowerCase();
    return getCatalogForCategory(assetCategory, options)
        .map(entry => ({
            entry,
            score: scoreCuratedTicker(entry, assetCategory, normalizedQuery),
        }))
        .filter(match => match.score >= 0)
        .sort((left, right) => right.score - left.score || left.entry.label.localeCompare(right.entry.label))
        .map(match => cloneCatalogEntry(match.entry));
}

/* Crypto resolution chooses a single confident match when the query is precise enough. */
export function resolveCryptoCatalogTicker(query, cryptoCatalog = null, cryptoProvider = CRYPTO_PROVIDERS.KRAKEN) {
    const matches = matchCuratedTickers(ASSET_CATEGORIES.CRYPTO, query, {cryptoCatalog, cryptoProvider});
    if (matches.length === 0)
        return null;

    const [firstMatch, secondMatch] = matches;
    if (!firstMatch)
        return null;

    if (!secondMatch)
        return firstMatch;

    const firstScore = scoreCryptoCatalogEntry(firstMatch, query, cryptoProvider);
    const secondScore = scoreCryptoCatalogEntry(secondMatch, query, cryptoProvider);

    return firstScore > secondScore ? firstMatch : null;
}

/* Non-crypto scoring is intentionally simpler because its catalog is curated and more stable than runtime crypto lists. */
function scoreCuratedTicker(entry, assetCategory, normalizedQuery) {
    if (normalizedQuery === '')
        return Number.NEGATIVE_INFINITY;

    if (assetCategory === ASSET_CATEGORIES.CRYPTO && entry.liveSymbol)
        return scoreCryptoCatalogEntry(entry, normalizedQuery, entry.cryptoProvider ?? CRYPTO_PROVIDERS.KRAKEN);

    const haystack = [
        entry.label,
        entry.symbol,
        ...entry.keywords ?? [],
        ...getAssetCategorySearchTerms(entry.assetCategory),
    ].map(value => `${value}`.toLowerCase());

    if (haystack.some(value => value === normalizedQuery))
        return 500;

    if (haystack.some(value => value.startsWith(normalizedQuery)))
        return 350;

    if (haystack.some(value => value.includes(normalizedQuery)))
        return 250;

    if (haystack.some(value => isSubsequenceMatch(value, normalizedQuery)))
        return 150;

    return -1;
}

/* Provider-specific crypto scoring is delegated so ticker-catalog stays orchestration-oriented, not provider-aware. */
function scoreCryptoCatalogEntry(entry, query, cryptoProvider) {
    return getCryptoProviderAdapter(cryptoProvider ?? CRYPTO_PROVIDERS.KRAKEN)
        .scoreCatalogEntry(entry, query);
}

/* prefs can swap between static curated lists and runtime crypto catalogs through this single catalog selector. */
function getCatalogForCategory(assetCategory, options = {}) {
    const cryptoCatalog = Array.isArray(options.cryptoCatalog) && options.cryptoCatalog.length > 0
        ? options.cryptoCatalog
        : null;

    if (assetCategory === ASSET_CATEGORIES.CRYPTO && cryptoCatalog)
        return cryptoCatalog.map(cloneCatalogEntry);

    return getCuratedTickersForCategory(assetCategory);
}

/* Returning cloned catalog entries avoids accidental mutation of the shared suggestion sources. */
function cloneCatalogEntry(entry) {
    return {
        ...entry,
        keywords: [...entry.keywords ?? []],
    };
}

/* Subsequence matching gives the search one forgiving fallback without becoming fully fuzzy/expensive. */
function isSubsequenceMatch(value, query) {
    if (query.length < 2)
        return false;

    let queryIndex = 0;
    for (const character of value) {
        if (character === query[queryIndex])
            queryIndex += 1;

        if (queryIndex === query.length)
            return true;
    }

    return false;
}
