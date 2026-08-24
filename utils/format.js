import {
    DEFAULT_DISPLAY_SETTINGS,
    FORMAT_PRESETS,
    getSeparatorText,
} from './display-settings.js';

/*
 * Formatting converts ticker + quote data into display fragments, colors, and
 * visibility flags. It is intentionally dumb about where data came from and is
 * reused by both loading/error states and the normal render path.
 */
/* Neutral fragments use null so the indicator inherits the active Shell theme color. */
export const POSITIVE_COLOR = '#3FB950';
export const NEGATIVE_COLOR = '#F85149';

/* Startup/loading flows build one placeholder entry per ticker through this batch helper. */
export function createLoadingEntries(tickers, displaySettings = DEFAULT_DISPLAY_SETTINGS) {
    return tickers.map((ticker, index) => createLoadingEntry(ticker, index, displaySettings));
}

/* Loading entries are the optimistic placeholder state shown before the quote pipeline has produced data. */
export function createLoadingEntry(ticker, index, displaySettings = DEFAULT_DISPLAY_SETTINGS) {
    return createBaseEntry({
        ticker,
        index,
        displaySettings,
        priceText: '...',
        displayPrice: null,
        arrow: '',
        percentText: '',
        priceColor: null,
        changeColor: null,
        isStale: true,
    });
}

/* Error entries preserve layout while signaling that data for a ticker could not be produced right now. */
export function createErrorEntry(ticker, index, displaySettings = DEFAULT_DISPLAY_SETTINGS) {
    return createBaseEntry({
        ticker,
        index,
        displaySettings,
        priceText: '--',
        displayPrice: null,
        arrow: '',
        percentText: '',
        priceColor: null,
        changeColor: null,
        isStale: true,
    });
}

/* Display entries are the normal success path from normalized quotes into panel-facing text fragments. */
export function createDisplayEntry(ticker, quote, previousClose, index, displaySettings = DEFAULT_DISPLAY_SETTINGS, {isStale = false} = {}) {
    const priceText = formatPrice(quote.price, ticker.priceDecimals);

    if (!Number.isFinite(previousClose)) {
        return createBaseEntry({
            ticker,
            index,
            displaySettings,
            priceText,
            displayPrice: quote.price,
            arrow: '',
            percentText: '',
            priceColor: null,
            changeColor: null,
            isStale,
        });
    }

    const percentChange = ((quote.price - previousClose) / previousClose) * 100;

    return createBaseEntry({
        ticker,
        index,
        displaySettings,
        priceText,
        displayPrice: quote.price,
        arrow: getArrow(percentChange),
        percentText: formatPercentChange(percentChange),
        priceColor: null,
        changeColor: isStale ? null : getChangeColor(percentChange),
        isStale,
    });
}

/* Base entry construction keeps all render-state shapes uniform before the indicator consumes them. */
function createBaseEntry({
    ticker,
    index,
    displaySettings,
    priceText,
    displayPrice,
    arrow,
    percentText,
    priceColor,
    changeColor,
    isStale = false,
}) {
    const visibility = resolveVisibility(displaySettings);

    return {
        label: ticker.label,
        symbol: ticker.symbol,
        separatorBefore: index > 0
            ? ticker.separatorBefore ?? getSeparatorText(displaySettings.separatorStyle)
            : '',
        priceText,
        displayPrice,
        arrow,
        percentText,
        showPrice: visibility.showPrice,
        showArrow: visibility.showArrow && arrow !== '',
        showPercent: visibility.showPercent && percentText !== '',
        priceColor,
        changeColor,
        isStale,
        priceFlash: false,
    };
}

/* Presets define the system's coarse display modes before per-setting toggles are applied. */
function resolveVisibility(displaySettings) {
    const settings = {...DEFAULT_DISPLAY_SETTINGS, ...displaySettings};

    let presetVisibility;
    switch (settings.formatPreset) {
    case FORMAT_PRESETS.CHANGE:
        presetVisibility = {showPrice: false, showArrow: true, showPercent: true};
        break;
    case FORMAT_PRESETS.PRICE:
        presetVisibility = {showPrice: true, showArrow: false, showPercent: false};
        break;
    case FORMAT_PRESETS.DEFAULT:
    default:
        presetVisibility = {showPrice: true, showArrow: true, showPercent: true};
        break;
    }

    return {
        showPrice: presetVisibility.showPrice && settings.showPrice,
        showArrow: presetVisibility.showArrow && settings.showArrow,
        showPercent: presetVisibility.showPercent && settings.showPercent,
    };
}

/* Price text formatting is centralized so all success states display numeric precision consistently. */
function formatPrice(price, decimals) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(price);
}

/*
 * Spot FX and metals reset their reference close at 17:00 New York, so for hours afterwards
 * a real move is a few hundredths of a percent. One decimal renders those as a flat 0.0%.
 */
function formatPercentChange(percentChange) {
    const magnitude = Math.abs(percentChange);
    return `${magnitude.toFixed(magnitude < 0.1 ? 2 : 1)}%`;
}

/* Arrows are derived once here so all entry creators share the same directional language. */
function getArrow(percentChange) {
    if (percentChange > 0)
        return '\u25b2';

    if (percentChange < 0)
        return '\u25bc';

    return '\u25ba';
}

/* Change color policy stays centralized so panel rendering does not need to re-decide positive/negative semantics. */
function getChangeColor(percentChange) {
    if (percentChange > 0)
        return POSITIVE_COLOR;

    if (percentChange < 0)
        return NEGATIVE_COLOR;

    return null;
}
