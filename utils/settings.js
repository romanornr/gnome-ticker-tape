import {
    ASSET_CATEGORIES,
    CRYPTO_PROVIDERS,
} from './asset-categories.js';
import {
    DEFAULT_DISPLAY_SETTINGS,
    DEFAULT_REFRESH_INTERVAL_SECONDS,
    FONT_PRESETS,
    SEPARATOR_STYLES,
} from './display-settings.js';
import {LEFT_PANEL_SIDE, RIGHT_PANEL_SIDE} from './panel-sides.js';
import {
    normalizeTickerConfig,
    serializeTickerConfig,
} from './ticker-config.js';

export const SETTINGS_KEYS = {
    TICKERS_JSON: 'tickers-json',
    REFRESH_INTERVAL_SECONDS: 'refresh-interval-seconds',
    SHOW_PRICE: 'show-price',
    SHOW_ARROW: 'show-arrow',
    SHOW_PERCENT: 'show-percent',
    SEPARATOR_STYLE: 'separator-style',
    FONT_PRESET: 'font-preset',
};

const DEFAULT_TICKERS = [
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
];

export function loadTickerConfigs(settings) {
    const serialized = settings.get_string(SETTINGS_KEYS.TICKERS_JSON);
    if (serialized.trim() === '')
        return loadDefaultTickers();

    try {
        const parsed = JSON.parse(serialized);
        if (!Array.isArray(parsed))
            return loadDefaultTickers();

        if (parsed.length === 0)
            return [];

        const tickers = parsed
            .map(normalizeTickerConfig)
            .filter(ticker => ticker !== null);

        return tickers.length > 0 ? tickers : loadDefaultTickers();
    } catch (error) {
        logError(error, 'ticker-tape: invalid ticker settings, using defaults');
        return loadDefaultTickers();
    }
}

export function saveTickerConfigs(settings, tickers) {
    settings.set_string(SETTINGS_KEYS.TICKERS_JSON, JSON.stringify(tickers.map(serializeTickerConfig)));
}

export function resetTickerConfigs(settings) {
    settings.reset(SETTINGS_KEYS.TICKERS_JSON);
}

export function loadDisplaySettings(settings) {
    const separatorStyle = normalizeEnum(
        settings.get_string(SETTINGS_KEYS.SEPARATOR_STYLE),
        SEPARATOR_STYLES,
        DEFAULT_DISPLAY_SETTINGS.separatorStyle
    );
    const fontPreset = normalizeEnum(
        settings.get_string(SETTINGS_KEYS.FONT_PRESET),
        FONT_PRESETS,
        DEFAULT_DISPLAY_SETTINGS.fontPreset
    );

    return {
        showPrice: settings.get_boolean(SETTINGS_KEYS.SHOW_PRICE),
        showArrow: settings.get_boolean(SETTINGS_KEYS.SHOW_ARROW),
        showPercent: settings.get_boolean(SETTINGS_KEYS.SHOW_PERCENT),
        separatorStyle,
        fontPreset,
    };
}

export function loadRefreshIntervalSeconds(settings) {
    const interval = settings.get_uint(SETTINGS_KEYS.REFRESH_INTERVAL_SECONDS);
    return Number.isInteger(interval) && interval > 0 ? interval : DEFAULT_REFRESH_INTERVAL_SECONDS;
}

function loadDefaultTickers() {
    return DEFAULT_TICKERS.map(normalizeTickerConfig);
}

function normalizeEnum(value, enumValues, fallback) {
    return Object.values(enumValues).includes(value) ? value : fallback;
}
