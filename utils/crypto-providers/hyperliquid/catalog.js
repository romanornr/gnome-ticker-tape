import Soup from 'gi://Soup?version=3.0';

import {ASSET_CATEGORIES, CRYPTO_PROVIDERS} from '../../asset-categories.js';
import {httpPostJson} from '../../http.js';
import {normalizeHyperliquidLiveSymbol, normalizeHyperliquidTickerSymbol} from './symbols.js';

const HYPERLIQUID_API_URL = 'https://api.hyperliquid.xyz/info';
export const HYPERLIQUID_WEBSOCKET_URL = 'wss://api.hyperliquid.xyz/ws';

let cachedHyperliquidMarketsPromise = null;

export function loadHyperliquidMarkets() {
    if (!cachedHyperliquidMarketsPromise) {
        cachedHyperliquidMarketsPromise = _fetchHyperliquidMarkets().catch(error => {
            cachedHyperliquidMarketsPromise = null;
            throw error;
        });
    }

    return cachedHyperliquidMarketsPromise;
}

/* Prefs discovery and REST fallback share the perpetual-market snapshot. */
export async function fetchHyperliquidMarketSnapshots(session) {
    return buildHyperliquidPerpEntries(
        await httpPostJson(session, HYPERLIQUID_API_URL, {type: 'metaAndAssetCtxs'})
    );
}

/* The runtime catalog is cached because Hyperliquid metadata changes infrequently. */
async function _fetchHyperliquidMarkets() {
    const session = new Soup.Session();

    try {
        return (await fetchHyperliquidMarketSnapshots(session))
            .sort((left, right) => left.label.localeCompare(right.label));
    } finally {
        session.abort();
    }
}

function buildHyperliquidPerpEntries(response) {
    if (!Array.isArray(response) || response.length !== 2 ||
        !Array.isArray(response[0]?.universe) || !Array.isArray(response[1]))
        throw new Error('Hyperliquid returned an invalid market snapshot.');

    const [meta, contexts] = response;

    return meta.universe
        .map((market, index) => createHyperliquidPerpCatalogEntry(market, contexts[index]))
        .filter(entry => entry !== null);
}

function createHyperliquidPerpCatalogEntry(market, ctx) {
    const liveSymbol = normalizeHyperliquidLiveSymbol(market?.name);
    if (liveSymbol === '' || market?.isDelisted === true) return null;

    return {
        assetCategory: ASSET_CATEGORIES.CRYPTO,
        cryptoProvider: CRYPTO_PROVIDERS.HYPERLIQUID,
        label: `${liveSymbol} Perp`,
        symbol: normalizeHyperliquidTickerSymbol(liveSymbol),
        priceDecimals: deriveHyperliquidPriceDecimals(ctx),
        liveSymbol,
        keywords: [liveSymbol, 'perp', 'perpetual'],
        base: liveSymbol,
        quote: 'USD',
        ctx,
    };
}

/* Price precision is derived from provider text because Hyperliquid does not ship one fixed decimal field. */
function deriveHyperliquidPriceDecimals(ctx) {
    const priceText = `${ctx?.midPx ?? ctx?.markPx ?? ctx?.prevDayPx ?? ''}`.trim();
    if (priceText === '') return 2;

    const [, decimals = ''] = priceText.split('.');
    return Math.min(6, Math.max(0, decimals.length));
}
