import {
    ASSET_CATEGORIES,
    CRYPTO_PROVIDERS,
    getTickerMarketSessionId,
} from './asset-categories.js';
import {
    normalizeHyperliquidLiveSymbol,
    normalizeHyperliquidTickerSymbol,
} from './crypto-providers/hyperliquid/symbols.js';
import {
    normalizeKrakenLiveSymbol,
    normalizeKrakenTickerSymbol,
} from './crypto-providers/kraken/symbols.js';
import {LEFT_PANEL_SIDE, RIGHT_PANEL_SIDE} from './panel-sides.js';

const ASSET_CATEGORY_VALUES = Object.values(ASSET_CATEGORIES);
const CRYPTO_PROVIDER_VALUES = Object.values(CRYPTO_PROVIDERS);

/* Saved ticker data is validated as the current format; exchange sessions are derived. */
export function normalizeTickerConfig(rawTicker) {
    if (!rawTicker || typeof rawTicker !== 'object')
        return null;

    const label = normalizeText(rawTicker.label);
    const assetCategory = ASSET_CATEGORY_VALUES.includes(rawTicker.assetCategory)
        ? rawTicker.assetCategory
        : null;
    const priceDecimals = rawTicker.priceDecimals;
    if (
        label === '' ||
        assetCategory === null ||
        !Number.isInteger(priceDecimals) ||
        priceDecimals < 0 ||
        priceDecimals > 6
    )
        return null;

    const symbol = normalizeText(rawTicker.symbol).toLowerCase();
    const ticker = {
        label,
        symbol,
        priceDecimals,
        marketSessionId: getTickerMarketSessionId({assetCategory, symbol}),
        assetCategory,
        panelSide: rawTicker.panelSide === LEFT_PANEL_SIDE ? LEFT_PANEL_SIDE : RIGHT_PANEL_SIDE,
    };

    if (assetCategory !== ASSET_CATEGORIES.CRYPTO)
        return ticker.symbol === '' ? null : ticker;

    if (!CRYPTO_PROVIDER_VALUES.includes(rawTicker.cryptoProvider))
        return null;

    const [normalizeLiveSymbol, normalizeTickerSymbol] = rawTicker.cryptoProvider === CRYPTO_PROVIDERS.KRAKEN
        ? [normalizeKrakenLiveSymbol, normalizeKrakenTickerSymbol]
        : [normalizeHyperliquidLiveSymbol, normalizeHyperliquidTickerSymbol];
    const liveSymbol = normalizeLiveSymbol(rawTicker.liveSymbol);
    if (liveSymbol === '')
        return null;

    const normalizedSymbol = normalizeTickerSymbol(liveSymbol);
    if (ticker.symbol !== normalizedSymbol)
        return null;

    ticker.cryptoProvider = rawTicker.cryptoProvider;
    ticker.liveSymbol = liveSymbol;
    return ticker;
}

/* Derived session data is deliberately excluded from persisted ticker configuration. */
export function serializeTickerConfig(ticker) {
    const serialized = {
        label: ticker.label,
        symbol: ticker.symbol,
        priceDecimals: ticker.priceDecimals,
        assetCategory: ticker.assetCategory,
        panelSide: ticker.panelSide,
    };

    if (ticker.assetCategory === ASSET_CATEGORIES.CRYPTO) {
        serialized.cryptoProvider = ticker.cryptoProvider;
        serialized.liveSymbol = ticker.liveSymbol;
    }

    return serialized;
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
