import {DEFAULT_HTTP_TIMEOUT_SECONDS, httpGetJson} from '../../utils/http.js';
import {
    buildFxSpotSymbol,
    mapSymbolToCnbc,
    parseFxPairSymbol,
    toUsdPerUnit,
} from './cnbc-symbols.js';

const CNBC_BATCH_SIZE = 30;
const CNBC_USER_AGENT = 'ticker-tape-gnome-extension/1.0';
const CNBC_QUOTE_ENDPOINT = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';

export async function refresh(tickers, {session}) {
    if (!session || tickers.length === 0)
        return new Map();

    const {requests, symbols} = buildRequestPlan(tickers);
    const sourceQuotes = await fetchQuotes(session, [...symbols]);
    const quotes = new Map();
    requests.forEach(({storeKey, cnbcSymbol, fxPair}) => {
        const quote = cnbcSymbol
            ? sourceQuotes.get(cnbcSymbol)
            : deriveFxQuote(fxPair, sourceQuotes);
        if (quote) quotes.set(storeKey, quote);
    });
    return quotes;
}

function buildQuoteUrl(cnbcSymbols) {
    const symbols = cnbcSymbols
        .map(cnbcSymbol => encodeURIComponent(cnbcSymbol).replace(/%3D/g, '='))
        .join('|');
    return `${CNBC_QUOTE_ENDPOINT}?symbols=${symbols}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`;
}

export function parseRestQuoteResponse(payload) {
    const result = payload?.FormattedQuoteResult;
    const entries = result?.FormattedQuote;
    if (!result || typeof result !== 'object' ||
        (!Array.isArray(entries) && (!entries || typeof entries !== 'object')))
        throw new Error('CNBC returned an invalid quote response.');

    const quotesByCnbcSymbol = new Map();
    (Array.isArray(entries) ? entries : [entries]).forEach(entry => {
        const cnbcSymbol = typeof entry?.symbol === 'string' ? entry.symbol.trim().toUpperCase() : '';
        const price = parseQuoteNumber(entry?.last);
        const quoteDate = parseQuoteDate(entry?.last_time);

        if (cnbcSymbol === '' || price === null || price <= 0 || quoteDate === '')
            return;

        /* CNBC change stays anchored to the prior close when previous_day_closing rolls forward. */
        const change = parseQuoteNumber(entry?.change);
        const previousClose = change !== null
            ? price - change
            : parseQuoteNumber(entry?.previous_day_closing);
        quotesByCnbcSymbol.set(cnbcSymbol, {price, quoteDate,
            previousClose: previousClose !== null && previousClose > 0 ? previousClose : null});
    });

    return quotesByCnbcSymbol;
}

function parseQuoteNumber(text) {
    if (typeof text !== 'string' && typeof text !== 'number')
        return null;

    const normalized = `${text}`.trim();
    if (!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)$/.test(normalized))
        return null;

    const value = Number(normalized.replaceAll(',', ''));
    return Number.isFinite(value) ? value : null;
}

function parseQuoteDate(text) {
    if (typeof text !== 'string') return '';
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z| ?[A-Z]{2,5}|[+-]\d{2}:?\d{2})?)?$/.exec(text.trim());
    if (!match) return '';

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])
        ? `${match[1]}${match[2]}${match[3]}`
        : '';
}

/* Use the oldest FX component date so the synthetic quote is not newer than its inputs. */
export function deriveFxQuote({baseCurrency, quoteCurrency}, quotesByCnbcSymbol) {
    const baseLeg = resolveFxLeg(baseCurrency, quotesByCnbcSymbol);
    const quoteLeg = resolveFxLeg(quoteCurrency, quotesByCnbcSymbol);
    if (!baseLeg || !quoteLeg)
        return null;

    const price = baseLeg.usdPerUnit / quoteLeg.usdPerUnit;
    if (!Number.isFinite(price) || price <= 0)
        return null;

    const previousCloseRatio = baseLeg.previousUsdPerUnit !== null && quoteLeg.previousUsdPerUnit !== null
        ? baseLeg.previousUsdPerUnit / quoteLeg.previousUsdPerUnit
        : null;
    const previousClose = Number.isFinite(previousCloseRatio) && previousCloseRatio > 0
        ? previousCloseRatio
        : null;
    const quoteDate = [baseLeg.quoteDate, quoteLeg.quoteDate].filter(Boolean).sort().at(0) ?? '';
    if (quoteDate === '')
        return null;

    return {price, quoteDate, previousClose};
}

function resolveFxLeg(currencyCode, quotesByCnbcSymbol) {
    if (currencyCode === 'USD')
        return {usdPerUnit: 1, previousUsdPerUnit: 1, quoteDate: null};

    const quote = quotesByCnbcSymbol.get(buildFxSpotSymbol(currencyCode));
    if (!quote)
        return null;

    const usdPerUnit = toUsdPerUnit(currencyCode, quote.price);
    if (usdPerUnit === null)
        return null;

    return {
        usdPerUnit,
        previousUsdPerUnit: quote.previousClose !== null ? toUsdPerUnit(currencyCode, quote.previousClose) : null,
        quoteDate: quote.quoteDate,
    };
}

function buildRequestPlan(tickers) {
    const requests = [];
    const symbols = new Set();

    tickers.forEach(ticker => {
        const storeKey = ticker.symbol.toUpperCase();
        const fxPair = parseFxPairSymbol(ticker.symbol);
        if (fxPair) {
            requests.push({storeKey, fxPair});
            [fxPair.baseCurrency, fxPair.quoteCurrency]
                .map(buildFxSpotSymbol).filter(Boolean).forEach(symbol => symbols.add(symbol));
        } else {
            const cnbcSymbol = mapSymbolToCnbc(ticker.symbol);
            if (!cnbcSymbol) return;
            requests.push({storeKey, cnbcSymbol});
            symbols.add(cnbcSymbol);
        }
    });
    return {requests, symbols};
}

async function fetchQuotes(session, cnbcSymbols) {
    const quotesByCnbcSymbol = new Map();
    const batches = Array.from({length: Math.ceil(cnbcSymbols.length / CNBC_BATCH_SIZE)}, (_unused, index) =>
        cnbcSymbols.slice(index * CNBC_BATCH_SIZE, (index + 1) * CNBC_BATCH_SIZE));
    const results = await Promise.allSettled(batches.map(batch =>
        httpGetJson(session, buildQuoteUrl(batch), {
            timeoutMessage: `Timed out after ${DEFAULT_HTTP_TIMEOUT_SECONDS}s while loading CNBC quotes.`,
            headers: {'User-Agent': CNBC_USER_AGENT},
        }).then(parseRestQuoteResponse)));

    results.filter(result => result.status === 'fulfilled').forEach(result =>
        result.value.forEach((quote, symbol) => quotesByCnbcSymbol.set(symbol, quote)));

    const error = results.find(result => result.status === 'rejected')?.reason;
    if (quotesByCnbcSymbol.size === 0 && error) throw error;

    return quotesByCnbcSymbol;
}
