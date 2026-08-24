import {
    ASSET_CATEGORIES,
    CRYPTO_PROVIDERS,
    getDefaultCryptoProvider,
    getTickerMarketSessionPolicy,
} from '../asset-categories.js';
import {findCuratedTicker, matchCuratedTickers, resolveCryptoCatalogTicker} from '../ticker-catalog.js';

/*
 * These are the pure state and validation rules behind the ticker dialog.
 *
 * The controller handles GTK widgets and async flow; this file handles
 * deterministic decisions such as matching, validation text, and turning the
 * final dialog state back into a saved ticker config.
 */
/* Catalog search has one visible query source so label and symbol fields keep their saved-config meaning. */
export function getCatalogSearchQuery(searchText) {
    return searchText.trim();
}

/* The controller reads this copy helper so provider-specific suggestion language lives with dialog state policy. */
export function getSuggestionsDescription(assetCategory, cryptoProvider) {
    if (assetCategory !== ASSET_CATEGORIES.CRYPTO)
        return 'Search the built-in catalog above, then choose a match to fill the ticker fields.';

    return cryptoProvider === CRYPTO_PROVIDERS.HYPERLIQUID
        ? 'Search live Hyperliquid spot symbols and perps. Non-crypto assets still use the built-in catalog.'
        : 'Search live Kraken WebSocket pairs. Non-crypto assets still use the built-in catalog.';
}

/* Catalog options bundle the runtime crypto catalog and provider choice into one reusable lookup input. */
export function getCatalogOptions(cryptoCatalog, cryptoProvider) {
    return {
        cryptoCatalog: Array.isArray(cryptoCatalog) && cryptoCatalog.length > 0 ? cryptoCatalog : null,
        cryptoProvider,
    };
}

/* Exact-or-confident crypto resolution happens here before the controller validates or saves a draft. */
export function resolveSelectedCryptoTicker({assetCategory, cryptoCatalog, cryptoProvider, labelText, symbolText}) {
    if (assetCategory !== ASSET_CATEGORIES.CRYPTO)
        return null;

    const query = symbolText.trim();
    if (query === '')
        return null;

    const exactMatch = findCuratedTicker({
        label: labelText.trim(),
        symbol: query,
        assetCategory,
    }, getCatalogOptions(cryptoCatalog, cryptoProvider));

    return exactMatch ?? resolveCryptoCatalogTicker(query, cryptoCatalog, cryptoProvider);
}

/* Validation text is centralized so the dialog's sensitivity and error label always agree. */
export function validateTickerDraft(label, symbol, options = {}) {
    if (options.assetCategory === ASSET_CATEGORIES.CRYPTO) {
        if (symbol.trim() === '')
            return 'Enter a symbol.';

        if (options.cryptoCatalogLoading) {
            return options.cryptoProvider === CRYPTO_PROVIDERS.HYPERLIQUID
                ? 'Hyperliquid crypto symbols are still loading.'
                : 'Kraken crypto pairs are still loading.';
        }

        if (options.cryptoCatalogError) {
            return options.cryptoProvider === CRYPTO_PROVIDERS.HYPERLIQUID
                ? 'Hyperliquid crypto symbols could not be loaded.'
                : 'Kraken crypto pairs could not be loaded.';
        }

        if (!options.resolvedCryptoTicker && options.hasCryptoCatalogMatches) {
            return options.cryptoProvider === CRYPTO_PROVIDERS.HYPERLIQUID
                ? 'Keep typing or choose a suggested Hyperliquid spot symbol or perp.'
                : 'Keep typing or choose a suggested Kraken pair.';
        }

        if (!options.resolvedCryptoTicker) {
            return options.cryptoProvider === CRYPTO_PROVIDERS.HYPERLIQUID
                ? 'Choose a Hyperliquid-supported spot symbol or perp.'
                : 'Choose a Kraken-supported crypto pair.';
        }

        return '';
    }

    if (label.trim() === '')
        return 'Enter a name.';

    return validateTickerSymbol(symbol);
}

/* Non-crypto symbols still use this lightweight syntactic gate before network verification. */
export function validateTickerSymbol(symbol) {
    if (symbol.trim() === '')
        return 'Enter a symbol.';

    if (/\s/.test(symbol))
        return 'Symbols cannot contain spaces.';

    return '';
}

/* Final dialog state becomes a saved ticker config here, with crypto/provider-specific normalization applied. */
export function buildTickerConfig({
    initialTicker,
    labelText,
    symbolText,
    priceDecimals,
    panelSide,
    assetCategory,
    marketSessionId,
    cryptoProvider,
    resolvedCryptoTicker,
    cryptoCatalog,
}) {
    const effectiveLabel = assetCategory === ASSET_CATEGORIES.CRYPTO && labelText.trim() === ''
        ? resolvedCryptoTicker?.label ?? ''
        : labelText.trim();
    const effectiveSymbol = assetCategory === ASSET_CATEGORIES.CRYPTO
        ? resolvedCryptoTicker?.liveSymbol ?? symbolText.trim()
        : symbolText.trim().toLowerCase();
    const matchingCuratedTicker = findCuratedTicker({
        label: effectiveLabel,
        symbol: effectiveSymbol,
        assetCategory,
    }, getCatalogOptions(cryptoCatalog, cryptoProvider));

    const nextTicker = {
        ...initialTicker,
        label: effectiveLabel,
        symbol: assetCategory === ASSET_CATEGORIES.CRYPTO
            ? resolvedCryptoTicker?.symbol ?? symbolText.trim().toLowerCase()
            : symbolText.trim().toLowerCase(),
        priceDecimals,
        panelSide,
        marketSessionId: marketSessionId || getTickerMarketSessionPolicy({assetCategory, symbol: effectiveSymbol}).defaultMarketSessionId,
        assetCategory,
    };

    if (assetCategory === ASSET_CATEGORIES.CRYPTO) {
        nextTicker.cryptoProvider = cryptoProvider || getDefaultCryptoProvider();
        nextTicker.liveSymbol = resolvedCryptoTicker?.liveSymbol ?? matchingCuratedTicker?.liveSymbol ?? '';
    } else {
        delete nextTicker.cryptoProvider;
        if (matchingCuratedTicker?.liveSymbol)
            nextTicker.liveSymbol = matchingCuratedTicker.liveSymbol;
        else
            delete nextTicker.liveSymbol;
    }

    return nextTicker;
}

/* Loading-state copy reflects the active provider so the dialog can stay transparent about runtime work. */
export function getCryptoCatalogLoadingMessage(cryptoProvider) {
    return cryptoProvider === CRYPTO_PROVIDERS.HYPERLIQUID
        ? 'Fetching live Hyperliquid spot symbols and perps for search and selection.'
        : 'Fetching active Kraken WebSocket pairs for search and selection.';
}

/* Unavailable-state copy is provider-specific but still part of the pure dialog state model. */
export function getCryptoCatalogUnavailableTitle(cryptoProvider) {
    return cryptoProvider === CRYPTO_PROVIDERS.HYPERLIQUID
        ? 'Hyperliquid crypto catalog unavailable'
        : 'Kraken crypto catalog unavailable';
}

/* Prompt copy nudges the user toward valid provider-specific market shapes. */
export function getCryptoSearchPrompt(cryptoProvider) {
    return cryptoProvider === CRYPTO_PROVIDERS.HYPERLIQUID
        ? 'Type a perp like BTC or ETH, or a spot pair like ETH/USDC.'
        : 'Type a base asset or pair like SOL, SOLUSD, or SOL/USD.';
}

/* Empty-result copy stays alongside the rest of the dialog's provider-aware search policy. */
export function getCryptoEmptyStateSubtitle(cryptoProvider) {
    return cryptoProvider === CRYPTO_PROVIDERS.HYPERLIQUID
        ? 'Type an exact Hyperliquid perp like BTC or ETH, or a spot pair like ETH/USDC.'
        : 'Type an exact Kraken WebSocket pair like SOL/USD, or keep searching.';
}

/* The controller asks this helper for current matches instead of knowing catalog lookup details itself. */
export function getCatalogMatches(assetCategory, query, cryptoCatalog, cryptoProvider) {
    return matchCuratedTickers(assetCategory, query, getCatalogOptions(cryptoCatalog, cryptoProvider));
}
