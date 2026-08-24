import {CRYPTO_PROVIDERS} from '../asset-categories.js';
import {loadCryptoProviderCatalog} from '../crypto-providers/index.js';
import {
    getCatalogMatches,
    getCryptoCatalogLoadingMessage,
    getCryptoCatalogUnavailableTitle,
    getCryptoEmptyStateSubtitle,
    getCryptoSearchPrompt,
    getCatalogSearchQuery,
} from './ticker-dialog-state.js';

/*
 * This helper turns current dialog state into suggestion-row models.
 *
 * The controller owns widget state; this file owns the pure "what suggestions
 * should be shown right now?" logic plus the provider-specific market catalog
 * loading entrypoint.
 */
/* The dialog controller calls this provider switchboard to load the correct runtime crypto catalog. */
export function loadCryptoCatalog(cryptoProvider) {
    return loadCryptoProviderCatalog(cryptoProvider ?? CRYPTO_PROVIDERS.KRAKEN);
}

/* The dialog controller uses this pure row-model builder instead of mixing search policy into GTK widget code. */
export function buildCatalogSuggestionRows({
    assetCategory,
    cryptoProvider,
    cryptoCatalog,
    cryptoCatalogLoading,
    cryptoCatalogError,
    searchText,
    maxSuggestions,
}) {
    const query = getCatalogSearchQuery(searchText);

    if (assetCategory === 'crypto') {
        if (cryptoCatalogLoading) {
            return [{
                kind: 'info',
                title: 'Loading crypto pairs',
                subtitle: getCryptoCatalogLoadingMessage(cryptoProvider),
            }];
        }

        if (cryptoCatalogError !== '') {
            return [{
                kind: 'info',
                title: getCryptoCatalogUnavailableTitle(cryptoProvider),
                subtitle: cryptoCatalogError,
            }];
        }
    }

    if (query === '') {
        return [{
            kind: 'info',
            title: 'Start typing to search',
            subtitle: assetCategory === 'crypto'
                ? getCryptoSearchPrompt(cryptoProvider)
                : 'Curated matches stay hidden until you search the catalog.',
        }];
    }

    const matches = getCatalogMatches(assetCategory, query, cryptoCatalog, cryptoProvider);
    if (matches.length === 0) {
        return [{
            kind: 'info',
            title: 'No curated matches',
            subtitle: assetCategory === 'crypto'
                ? getCryptoEmptyStateSubtitle(cryptoProvider)
                : 'Try another label, symbol, or category term.',
        }];
    }

    const rows = matches.slice(0, maxSuggestions).map(curatedTicker => {
        const keywordText = (curatedTicker.keywords ?? []).slice(0, 3).join(' · ');
        const subtitle = keywordText === ''
            ? `${curatedTicker.liveSymbol ?? curatedTicker.symbol} · ${curatedTicker.priceDecimals} decimals`
            : `${curatedTicker.liveSymbol ?? curatedTicker.symbol} · ${curatedTicker.priceDecimals} decimals · ${keywordText}`;

        return {kind: 'match', title: curatedTicker.label, subtitle, curatedTicker};
    });

    if (matches.length > maxSuggestions)
        rows.push({kind: 'info', title: `Showing first ${maxSuggestions} matches`, subtitle: 'Keep typing to narrow the catalog results.'});

    return rows;
}
