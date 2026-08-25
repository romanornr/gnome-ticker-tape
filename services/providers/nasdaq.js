import {ASSET_CATEGORIES} from '../../utils/asset-categories.js';
import {DEFAULT_HTTP_TIMEOUT_SECONDS, httpGetJson} from '../../utils/http.js';

const NASDAQ_USER_AGENT = 'ticker-tape-gnome-extension/1.0';
const NASDAQ_QUOTE_ENDPOINT = 'https://api.nasdaq.com/api/quote';

const NASDAQ_ASSET_CLASSES = new Map([
    [ASSET_CATEGORIES.EQUITY, 'stocks'],
    [ASSET_CATEGORIES.ETF, 'etf'],
    [ASSET_CATEGORIES.COMMODITY, 'etf'],
]);

function getRequest(ticker) {
    if (ticker.symbol === '^ndq')
        return {storeKey: '^NDQ', nasdaqSymbol: 'NDX', assetClass: 'index'};
    if (!ticker.symbol.endsWith('.us') || !NASDAQ_ASSET_CLASSES.has(ticker.assetCategory))
        return null;
    return {storeKey: ticker.symbol.toUpperCase(),
        nasdaqSymbol: ticker.symbol.slice(0, -3).toUpperCase().replaceAll('-', '.'),
        assetClass: NASDAQ_ASSET_CLASSES.get(ticker.assetCategory)};
}

export async function refresh(tickers, {session}) {
    const quotesBySymbol = new Map();
    if (!session)
        return quotesBySymbol;

    const requests = new Map(tickers.map(getRequest).filter(Boolean).map(request => [request.storeKey, request]));
    const results = await Promise.allSettled([...requests.values()].map(request => fetchQuote(session, request)));

    results.filter(result => result.status === 'fulfilled' && result.value).forEach(({value}) =>
        quotesBySymbol.set(value.storeKey, value.quote));

    const error = results.find(result => result.status === 'rejected')?.reason;
    if (quotesBySymbol.size === 0 && error) throw error;

    return quotesBySymbol;
}

async function fetchQuote(session, {storeKey, nasdaqSymbol, assetClass}) {
    const url = `${NASDAQ_QUOTE_ENDPOINT}/${encodeURIComponent(nasdaqSymbol)}/info?assetclass=${assetClass}`;
    const payload = await httpGetJson(session, url, {
        timeoutMessage: `Timed out after ${DEFAULT_HTTP_TIMEOUT_SECONDS}s while loading Nasdaq quotes.`,
        headers: {'User-Agent': NASDAQ_USER_AGENT},
    });
    const quote = parseQuoteResponse(payload);
    return quote ? {storeKey, quote} : null;
}

export function parseQuoteResponse(payload) {
    if (!payload || typeof payload !== 'object' || !Object.hasOwn(payload, 'data'))
        throw new Error('Nasdaq returned an invalid quote response.');
    if (payload.data === null)
        return null;
    const primaryData = payload.data?.primaryData;
    if (!primaryData || typeof primaryData !== 'object')
        throw new Error('Nasdaq returned an invalid quote response.');

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
    if (typeof text !== 'string' && typeof text !== 'number')
        return null;

    const normalized = `${text}`.trim();
    if (!/^\$?[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)$/.test(normalized))
        return null;
    const value = Number(normalized.replace(/[$,]/g, ''));
    return Number.isFinite(value) ? value : null;
}

const MONTHS_BY_PREFIX = new Map([
    ['jan', '01'], ['feb', '02'], ['mar', '03'], ['apr', '04'], ['may', '05'], ['jun', '06'],
    ['jul', '07'], ['aug', '08'], ['sep', '09'], ['oct', '10'], ['nov', '11'], ['dec', '12'],
]);

function normalizeTradeTimestamp(timestampText) {
    if (typeof timestampText !== 'string') return '';
    const match = /^([A-Za-z]{3})[A-Za-z]* (\d{1,2}), (\d{4})(?: \d{1,2}:\d{2} [AP]M ET)?$/.exec(timestampText.trim());
    if (!match)
        return '';

    const month = MONTHS_BY_PREFIX.get(match[1].toLowerCase());
    if (!month)
        return '';

    const day = match[2].padStart(2, '0');
    const date = new Date(Date.UTC(Number(match[3]), Number(month) - 1, Number(day)));
    return date.getUTCFullYear() === Number(match[3]) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)
        ? `${match[3]}${month}${day}`
        : '';
}
