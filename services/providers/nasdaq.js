import {ASSET_CATEGORIES} from '../../utils/asset-categories.js';
import {DEFAULT_HTTP_TIMEOUT_SECONDS, httpGetJson} from '../../utils/http.js';

const NASDAQ_USER_AGENT = 'ticker-tape-gnome-extension/1.0';
const NASDAQ_MAX_SYMBOLS_PER_PASS = 25;

const NASDAQ_ASSET_CLASSES = new Map([
    [ASSET_CATEGORIES.EQUITY, 'stocks'],
    [ASSET_CATEGORIES.ETF, 'etf'],
    [ASSET_CATEGORIES.COMMODITY, 'etf'],
]);

/*
 * Nasdaq is the emergency fallback for US listings when the primary CNBC batch
 * misses them. It only understands US symbols; foreign catalog symbols would
 * resolve to NYSE ADRs with different prices, so ownership is restricted here.
 */
function ownsFallbackTicker(ticker) {
    return ticker.symbol.endsWith('.us') && NASDAQ_ASSET_CLASSES.has(ticker.assetCategory);
}

function mapSymbolToNasdaq(symbol) {
    const normalized = `${symbol ?? ''}`.trim().toLowerCase();
    if (!normalized.endsWith('.us'))
        return null;

    return normalized.slice(0, -3).toUpperCase().replace(/-/g, '.');
}

export async function refresh(tickers, {session}) {
    const quotesBySymbol = new Map();
    if (!session)
        return quotesBySymbol;

    const fallbackTickers = tickers.filter(ownsFallbackTicker);
    /* One request per symbol runs concurrently: serialized, a capped pass could stall a refresh for minutes on timeouts. */
    const results = await Promise.allSettled(fallbackTickers
        .slice(0, NASDAQ_MAX_SYMBOLS_PER_PASS)
        .map(ticker => fetchQuote(session, ticker)));

    results.forEach(result => {
        if (result.status === 'fulfilled' && result.value)
            quotesBySymbol.set(result.value.storeKey, result.value.quote);
    });

    return quotesBySymbol;
}

async function fetchQuote(session, ticker) {
    const nasdaqSymbol = mapSymbolToNasdaq(ticker.symbol);
    const assetClass = NASDAQ_ASSET_CLASSES.get(ticker.assetCategory);

    const payload = await httpGetJson(session, buildQuoteUrl(nasdaqSymbol, assetClass), {
        timeoutMessage: `Timed out after ${DEFAULT_HTTP_TIMEOUT_SECONDS}s while loading Nasdaq quotes.`,
        headers: {'User-Agent': NASDAQ_USER_AGENT},
    });
    const quote = parseQuoteResponse(payload);
    return quote ? {storeKey: ticker.symbol.toUpperCase(), quote} : null;
}

function buildQuoteUrl(nasdaqSymbol, assetClass) {
    return `https://api.nasdaq.com/api/quote/${encodeURIComponent(nasdaqSymbol)}/info?assetclass=${assetClass}`;
}

export function parseQuoteResponse(payload) {
    if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'data'))
        throw new Error('Nasdaq returned an invalid quote response.');
    if (payload.data === null)
        return null;
    if (typeof payload.data !== 'object' || !Object.hasOwn(payload.data, 'primaryData'))
        throw new Error('Nasdaq returned an invalid quote response.');

    const primaryData = payload.data.primaryData;
    const price = parseNasdaqNumber(primaryData?.lastSalePrice);
    const quoteDate = normalizeTradeTimestamp(primaryData?.lastTradeTimestamp);

    if (price === null || price <= 0 || quoteDate === '')
        return null;

    const netChange = parseNasdaqNumber(primaryData?.netChange);
    return {
        price,
        quoteDate,
        previousClose: netChange !== null && price - netChange > 0 ? price - netChange : null,
    };
}

function parseNasdaqNumber(text) {
    const normalized = `${text ?? ''}`.replace(/[$,]/g, '').trim();
    if (normalized === '')
        return null;

    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? value : null;
}

const MONTHS_BY_PREFIX = new Map([
    ['jan', '01'], ['feb', '02'], ['mar', '03'], ['apr', '04'], ['may', '05'], ['jun', '06'],
    ['jul', '07'], ['aug', '08'], ['sep', '09'], ['oct', '10'], ['nov', '11'], ['dec', '12'],
]);

function normalizeTradeTimestamp(timestampText) {
    const match = /^([A-Za-z]{3})[A-Za-z]* (\d{1,2}), (\d{4})/.exec(`${timestampText ?? ''}`.trim());
    if (!match)
        return '';

    const month = MONTHS_BY_PREFIX.get(match[1].toLowerCase());
    if (!month)
        return '';

    return `${match[3]}${month}${match[2].padStart(2, '0')}`;
}
