import {
    ASSET_CATEGORIES,
    CRYPTO_PROVIDERS,
    withDefaultMarketSession,
} from './asset-categories.js';
import {
    DEFAULT_DISPLAY_SETTINGS,
    DEFAULT_REFRESH_INTERVAL_SECONDS,
    FONT_PRESETS,
    FORMAT_PRESETS,
    SEPARATOR_STYLES,
} from './display-settings.js';
import {LEFT_PANEL_SIDE, RIGHT_PANEL_SIDE} from './panel-sides.js';
import {
    cloneTicker,
    normalizeTickerConfig,
    serializeTickerConfig,
} from './ticker-config.js';

export const SETTINGS_KEYS = {
    TICKERS_JSON: 'tickers-json',
    REFRESH_INTERVAL_SECONDS: 'refresh-interval-seconds',
    FORMAT_PRESET: 'format-preset',
    SHOW_PRICE: 'show-price',
    SHOW_ARROW: 'show-arrow',
    SHOW_PERCENT: 'show-percent',
    SEPARATOR_STYLE: 'separator-style',
    FONT_PRESET: 'font-preset',
};

export const DEFAULT_TICKERS = [
    {
        label: 'SPX',
        symbol: '^spx',
        priceDecimals: 0,
        assetCategory: ASSET_CATEGORIES.EQUITY,
        panelSide: RIGHT_PANEL_SIDE,
    },
    {
        label: 'NDX',
        symbol: '^ndq',
        priceDecimals: 0,
        assetCategory: ASSET_CATEGORIES.EQUITY,
        panelSide: RIGHT_PANEL_SIDE,
    },
    {
        label: 'DXY',
        symbol: 'dx.f',
        priceDecimals: 2,
        assetCategory: ASSET_CATEGORIES.FX,
        panelSide: LEFT_PANEL_SIDE,
    },
    {
        label: 'EUR/USD',
        symbol: 'eurusd',
        priceDecimals: 4,
        assetCategory: ASSET_CATEGORIES.FX,
        panelSide: LEFT_PANEL_SIDE,
    },
    {
        label: 'Gold',
        symbol: 'xauusd',
        priceDecimals: 0,
        assetCategory: ASSET_CATEGORIES.COMMODITY,
        panelSide: RIGHT_PANEL_SIDE,
    },
    {
        label: 'USO',
        symbol: 'uso.us',
        priceDecimals: 2,
        assetCategory: ASSET_CATEGORIES.ETF,
        panelSide: RIGHT_PANEL_SIDE,
    },
    {
        label: 'ETH',
        symbol: 'ethusd',
        priceDecimals: 0,
        assetCategory: ASSET_CATEGORIES.CRYPTO,
        cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
        panelSide: RIGHT_PANEL_SIDE,
        liveSymbol: 'ETH/USD',
    },
    {
        label: 'BTC',
        symbol: 'btcusd',
        priceDecimals: 0,
        assetCategory: ASSET_CATEGORIES.CRYPTO,
        cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
        panelSide: RIGHT_PANEL_SIDE,
        liveSymbol: 'BTC/USD',
    },
].map(withDefaultMarketSession);

export function loadTickerConfigs(settings) {
    const serialized = settings?.get_string(SETTINGS_KEYS.TICKERS_JSON) ?? '';
    if (serialized.trim() === '')
        return cloneTickers(DEFAULT_TICKERS);

    try {
        const parsed = JSON.parse(serialized);
        if (!Array.isArray(parsed))
            return cloneTickers(DEFAULT_TICKERS);

        /* Deleting the last ticker in prefs saves [], and the panel must then show nothing. */
        /* Defaults are only for a first run or a setting we cannot read, not for a list the user emptied. */
        if (parsed.length === 0)
            return [];

        const tickers = parsed
            .map(normalizeTickerConfig)
            .filter(ticker => ticker !== null);

        return tickers.length > 0 ? tickers : cloneTickers(DEFAULT_TICKERS);
    } catch (error) {
        logError(error, 'ticker-tape: invalid ticker settings, using defaults');
        return cloneTickers(DEFAULT_TICKERS);
    }
}

export function saveTickerConfigs(settings, tickers) {
    settings.set_string(SETTINGS_KEYS.TICKERS_JSON, JSON.stringify(tickers.map(serializeTickerConfig)));
}

export function resetTickerConfigs(settings) {
    settings.reset(SETTINGS_KEYS.TICKERS_JSON);
}

export function loadDisplaySettings(settings) {
    const formatPreset = normalizeEnum(
        settings?.get_string(SETTINGS_KEYS.FORMAT_PRESET),
        FORMAT_PRESETS,
        DEFAULT_DISPLAY_SETTINGS.formatPreset
    );
    const separatorStyle = normalizeEnum(
        settings?.get_string(SETTINGS_KEYS.SEPARATOR_STYLE),
        SEPARATOR_STYLES,
        DEFAULT_DISPLAY_SETTINGS.separatorStyle
    );
    const fontPreset = normalizeEnum(
        getOptionalStringSetting(settings, SETTINGS_KEYS.FONT_PRESET),
        FONT_PRESETS,
        DEFAULT_DISPLAY_SETTINGS.fontPreset
    );

    return {
        formatPreset,
        showPrice: settings?.get_boolean(SETTINGS_KEYS.SHOW_PRICE) ?? DEFAULT_DISPLAY_SETTINGS.showPrice,
        showArrow: settings?.get_boolean(SETTINGS_KEYS.SHOW_ARROW) ?? DEFAULT_DISPLAY_SETTINGS.showArrow,
        showPercent: settings?.get_boolean(SETTINGS_KEYS.SHOW_PERCENT) ?? DEFAULT_DISPLAY_SETTINGS.showPercent,
        separatorStyle,
        fontPreset,
    };
}

export function hasSettingsKey(settings, key) {
    return settings?.settings_schema?.has_key(key) ?? false;
}

export function loadRefreshIntervalSeconds(settings) {
    const interval = settings?.get_uint(SETTINGS_KEYS.REFRESH_INTERVAL_SECONDS) ?? DEFAULT_REFRESH_INTERVAL_SECONDS;
    return Number.isInteger(interval) && interval > 0 ? interval : DEFAULT_REFRESH_INTERVAL_SECONDS;
}

export function getTickersForSide(tickers, side) {
    return tickers.filter(ticker => (ticker.panelSide ?? RIGHT_PANEL_SIDE) === side);
}

function cloneTickers(tickers) {
    return tickers.map(cloneTicker);
}

function normalizeEnum(value, enumValues, fallback) {
    return Object.values(enumValues).includes(value) ? value : fallback;
}

function getOptionalStringSetting(settings, key) {
    if (!hasSettingsKey(settings, key))
        return null;

    return settings.get_string(key);
}
