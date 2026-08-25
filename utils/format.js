export const POSITIVE_COLOR = '#3FB950';
export const NEGATIVE_COLOR = '#F85149';

/* Quotes become presentation-neutral entry fragments consumed by the indicator. */
export function createLoadingEntries(tickers) {
    return tickers.map(ticker => createLoadingEntry(ticker));
}

export function createLoadingEntry(ticker) {
    return createBaseEntry(ticker, {
        priceText: '...',
        displayPrice: null,
        isStale: true,
    });
}

export function createErrorEntry(ticker) {
    return createBaseEntry(ticker, {
        priceText: '--',
        displayPrice: null,
        isStale: true,
    });
}

export function createDisplayEntry(ticker, quote, {isStale = false} = {}) {
    const previousClose = quote.previousClose;
    if (!Number.isFinite(previousClose) || previousClose <= 0) {
        return createBaseEntry(ticker, {
            priceText: formatPrice(quote.price, ticker.priceDecimals),
            displayPrice: quote.price,
            isStale,
        });
    }

    const percentChange = ((quote.price - previousClose) / previousClose) * 100;
    return createBaseEntry(ticker, {
        priceText: formatPrice(quote.price, ticker.priceDecimals),
        displayPrice: quote.price,
        arrow: getArrow(percentChange),
        percentText: formatPercentChange(percentChange),
        changeColor: isStale ? null : getChangeColor(percentChange),
        isStale,
    });
}

function createBaseEntry(ticker, {
    priceText,
    displayPrice,
    arrow = '',
    percentText = '',
    changeColor = null,
    isStale,
}) {
    return {
        label: ticker.label,
        symbol: ticker.symbol,
        panelSide: ticker.panelSide,
        priceText,
        displayPrice,
        arrow,
        percentText,
        priceColor: null,
        changeColor,
        isStale,
        priceFlash: false,
    };
}

function formatPrice(price, decimals) {
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(price);
}

function formatPercentChange(percentChange) {
    const decimals = Math.abs(percentChange) < 0.1 ? 2 : 1;
    return `${percentChange.toFixed(decimals)}%`;
}

function getArrow(percentChange) {
    if (percentChange > 0)
        return '\u25b2';
    if (percentChange < 0)
        return '\u25bc';
    return '\u25ba';
}

function getChangeColor(percentChange) {
    if (percentChange > 0)
        return POSITIVE_COLOR;
    if (percentChange < 0)
        return NEGATIVE_COLOR;
    return null;
}
