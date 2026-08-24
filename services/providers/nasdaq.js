import {ASSET_CATEGORIES} from '../../utils/asset-categories.js';
import {DEFAULT_HTTP_TIMEOUT_SECONDS, httpGetJson} from '../../utils/http.js';

const NASDAQ_USER_AGENT = 'ticker-tape-gnome-extension/1.0';
/* Nasdaq has no batch endpoint, so fallback passes stay bounded to avoid request storms. */
const NASDAQ_MAX_SYMBOLS_PER_PASS = 25;

/* US listings map to Nasdaq's assetclass parameter; commodity catalog entries with .us symbols are ETFs. */
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
export function ownsFallbackTicker(ticker) {
    const symbol = `${ticker?.symbol ?? ''}`.trim().toLowerCase();
    return symbol.endsWith('.us') && NASDAQ_ASSET_CLASSES.has(ticker?.assetCategory);
}

/* US class shares use dot notation on Nasdaq too (brk-b.us -> BRK.B). */
export function mapSymbolToNasdaq(symbol) {
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
    const results = await Promise.all(fallbackTickers
        .slice(0, NASDAQ_MAX_SYMBOLS_PER_PASS)
        .map(ticker => fetchQuote(session, ticker)));

    results.forEach(result => {
        if (result)
            quotesBySymbol.set(result.storeKey, result.quote);
    });

    return quotesBySymbol;
}

/* A single symbol's failure is contained here so it cannot reject the whole concurrent batch. */
async function fetchQuote(session, ticker) {
    const nasdaqSymbol = mapSymbolToNasdaq(ticker.symbol);
    const assetClass = NASDAQ_ASSET_CLASSES.get(ticker.assetCategory);

    try {
        const payload = await httpGetJson(session, buildQuoteUrl(nasdaqSymbol, assetClass), {
            timeoutMessage: `Timed out after ${DEFAULT_HTTP_TIMEOUT_SECONDS}s while loading Nasdaq quotes.`,
            headers: {'User-Agent': NASDAQ_USER_AGENT},
        });
        const quote = parseQuoteResponse(payload);
        return quote ? {storeKey: ticker.symbol.toUpperCase(), quote} : null;
    } catch {
        return null;
    }
}

export function buildQuoteUrl(nasdaqSymbol, assetClass) {
    return `https://api.nasdaq.com/api/quote/${encodeURIComponent(nasdaqSymbol)}/info?assetclass=${assetClass}`;
}

/* Nasdaq wraps quote data in a status envelope; previous close is reconstructed from last price and net change. */
export function parseQuoteResponse(payload) {
    const primaryData = payload?.data?.primaryData;
    const price = parseNasdaqNumber(primaryData?.lastSalePrice);
    const quoteDate = normalizeTradeTimestamp(primaryData?.lastTradeTimestamp);

    if (price === null || quoteDate === '')
        return null;

    const netChange = parseNasdaqNumber(primaryData?.netChange);
    return {
        price,
        quoteDate,
        previousClose: netChange !== null ? price - netChange : null,
    };
}

/* Nasdaq numbers carry currency signs and separators ("$1,234.56", "+9.205"). */
export function parseNasdaqNumber(text) {
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

/* Trade timestamps arrive as "Aug 3, 2026 12:27 PM ET" and normalize into YYYYMMDD. */
export function normalizeTradeTimestamp(timestampText) {
    const match = /^([A-Za-z]{3})[A-Za-z]* (\d{1,2}), (\d{4})/.exec(`${timestampText ?? ''}`.trim());
    if (!match)
        return '';

    const month = MONTHS_BY_PREFIX.get(match[1].toLowerCase());
    if (!month)
        return '';

    return `${match[3]}${month}${match[2].padStart(2, '0')}`;
}
