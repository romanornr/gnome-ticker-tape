import {DEFAULT_HTTP_TIMEOUT_SECONDS, httpGetJson} from '../../utils/http.js';
import {
    buildFxSpotSymbol,
    mapSymbolToCnbc,
    parseFxPairSymbol,
    toUsdPerUnit,
} from './cnbc-symbols.js';

const CNBC_BATCH_SIZE = 30;
/* CNBC rejects well-known tool user agents (curl, wget), so identify honestly as this extension. */
const CNBC_USER_AGENT = 'ticker-tape-gnome-extension/1.0';
const CNBC_QUOTE_ENDPOINT = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';
const DXY_SAVED_SYMBOL = 'dx.f';
/* Standard ICE U.S. Dollar Index formula against CNBC's matching six spot symbols. */
const DXY_FORMULA = {
    constant: 50.14348112,
    legs: [
        ['EUR=', -0.576],
        ['JPY=', 0.136],
        ['GBP=', -0.119],
        ['CAD=', 0.091],
        ['SEK=', 0.042],
        ['CHF=', 0.036],
    ],
};

/*
 * CNBC maps catalog tickers into batched wire symbols and normalized quotes.
 * FX pairs and DXY derive from per-currency USD spot legs in those same batches.
 */
export async function refresh(tickers, {session}) {
    if (!session || tickers.length === 0)
        return new Map();

    const plan = buildRequestPlan(tickers);
    const quotesByCnbcSymbol = await fetchQuotes(session, plan.requestSymbols);
    return assembleQuotes(plan, quotesByCnbcSymbol);
}

/* One batched URL serves runtime polling and verification; "=" and "|" must survive encoding for CNBC's grammar. */
export function buildQuoteUrl(cnbcSymbols) {
    const joinedSymbols = cnbcSymbols
        .map(cnbcSymbol => encodeURIComponent(cnbcSymbol).replace(/%3D/g, '='))
        .join('|');

    return `${CNBC_QUOTE_ENDPOINT}?symbols=${joinedSymbols}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`;
}

/*
 * Runtime batch parsing is intentionally tolerant: one unusable CNBC entry
 * should not prevent every other symbol in the batch from reaching QuoteStore.
 * Unknown symbols come back as bare {code, symbol} stubs and are skipped here.
 */
export function parseRestQuoteResponse(payload) {
    const quotesByCnbcSymbol = new Map();
    const entries = payload?.FormattedQuoteResult?.FormattedQuote;
    const quoteList = Array.isArray(entries) ? entries : entries ? [entries] : [];

    quoteList.forEach(entry => {
        const cnbcSymbol = `${entry?.symbol ?? ''}`.trim().toUpperCase();
        const price = parseQuoteNumber(entry?.last);
        const quoteDate = normalizeQuoteDate(entry?.last_time);

        if (cnbcSymbol === '' || !Number.isFinite(price) || quoteDate === '')
            return;

        /*
         * CNBC rolls previous_day_closing to the just-finished U.S. close before the next session prints.
         * It then equals last, so every U.S. ticker would read 0.00% until the open.
         * change stays anchored to the real prior close; last - change matches previous_day_closing while a market trades.
         */
        const change = parseQuoteNumber(entry?.change);
        const previousClose = Number.isFinite(change)
            ? price - change
            : parseQuoteNumber(entry?.previous_day_closing);
        quotesByCnbcSymbol.set(cnbcSymbol, {
            price,
            quoteDate,
            previousClose: Number.isFinite(previousClose) ? previousClose : null,
        });
    });

    return quotesByCnbcSymbol;
}

/* CNBC prices carry thousands separators ("4,118.90"), so numeric parsing strips them first. */
export function parseQuoteNumber(text) {
    const normalized = `${text ?? ''}`.replace(/,/g, '').trim();
    if (normalized === '')
        return null;

    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? value : null;
}

/* CNBC last_time is either a bare date or a full ISO timestamp; both normalize into YYYYMMDD. */
export function normalizeQuoteDate(dateText) {
    const normalized = `${dateText ?? ''}`.slice(0, 10).replaceAll('-', '');
    return /^\d{8}$/.test(normalized) ? normalized : '';
}

/* DXY keeps its saved catalog symbol while provider routing recognizes it as a derived basket. */
export function isDerivedDxySymbol(symbol) {
    return `${symbol ?? ''}`.trim().toLowerCase() === DXY_SAVED_SYMBOL;
}

/* An FX pair quote is the ratio of both legs' USD-per-unit rates, dated by the freshest leg. */
export function deriveFxQuote({baseCurrency, quoteCurrency}, quotesByCnbcSymbol) {
    const baseLeg = resolveFxLeg(baseCurrency, quotesByCnbcSymbol);
    const quoteLeg = resolveFxLeg(quoteCurrency, quotesByCnbcSymbol);
    if (!baseLeg || !quoteLeg)
        return null;

    const price = baseLeg.usdPerUnit / quoteLeg.usdPerUnit;
    if (!Number.isFinite(price))
        return null;

    const previousCloseRatio = baseLeg.previousUsdPerUnit !== null && quoteLeg.previousUsdPerUnit !== null
        ? baseLeg.previousUsdPerUnit / quoteLeg.previousUsdPerUnit
        : null;
    /* Validated like price, so a degenerate leg cannot leak a non-finite previous close downstream. */
    const previousClose = Number.isFinite(previousCloseRatio) ? previousCloseRatio : null;
    const quoteDate = [baseLeg.quoteDate, quoteLeg.quoteDate]
        .filter(date => date !== null)
        .sort()
        .at(-1) ?? '';
    if (quoteDate === '')
        return null;

    return {price, quoteDate, previousClose};
}

/* DXY derives from the same parsed spot vector as FX pairs and is valid only with a complete basket. */
export function deriveDxyQuote(quotesByCnbcSymbol) {
    const legs = DXY_FORMULA.legs.map(([symbol, exponent]) => [quotesByCnbcSymbol.get(symbol), exponent]);
    const deriveValue = field => {
        if (legs.some(([quote]) => !Number.isFinite(quote?.[field])))
            return null;

        const value = legs.reduce(
            (result, [quote, exponent]) => result * Math.pow(quote[field], exponent), DXY_FORMULA.constant);
        return Number.isFinite(value) ? value : null;
    };
    const price = deriveValue('price');
    if (price === null)
        return null;

    const quoteDate = legs.map(([quote]) => quote.quoteDate).filter(Boolean).sort().at(-1) ?? '';
    if (quoteDate === '')
        return null;

    return {price, quoteDate, previousClose: deriveValue('previousClose')};
}

/* USD is the vector anchor with no request of its own; every other leg must resolve from the fetched spot quotes. */
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

/* Tickers split into direct symbols, FX pairs, and DXY; every derived spot leg joins the same batch. */
function buildRequestPlan(tickers) {
    const directRequests = [];
    const fxRequests = [];
    const dxyRequests = [];
    const requestSymbols = new Set();

    tickers.forEach(ticker => {
        const symbol = `${ticker?.symbol ?? ''}`.trim();
        const storeKey = symbol.toUpperCase();
        const fxPair = parseFxPairSymbol(symbol);

        if (isDerivedDxySymbol(symbol)) {
            dxyRequests.push({storeKey});
            DXY_FORMULA.legs.forEach(([cnbcSymbol]) => requestSymbols.add(cnbcSymbol));
            return;
        }

        if (fxPair) {
            fxRequests.push({storeKey, fxPair});
            fxLegSymbols(fxPair).forEach(legSymbol => requestSymbols.add(legSymbol));
            return;
        }

        const cnbcSymbol = mapSymbolToCnbc(symbol);
        if (!cnbcSymbol)
            return;

        directRequests.push({storeKey, cnbcSymbol});
        requestSymbols.add(cnbcSymbol);
    });

    return {directRequests, fxRequests, dxyRequests, requestSymbols: [...requestSymbols]};
}

function fxLegSymbols({baseCurrency, quoteCurrency}) {
    return [baseCurrency, quoteCurrency]
        .map(currencyCode => buildFxSpotSymbol(currencyCode))
        .filter(legSymbol => legSymbol !== null);
}

function assembleQuotes({directRequests, fxRequests, dxyRequests}, quotesByCnbcSymbol) {
    const quotesBySymbol = new Map();

    directRequests.forEach(({storeKey, cnbcSymbol}) => {
        const quote = quotesByCnbcSymbol.get(cnbcSymbol);
        if (quote)
            quotesBySymbol.set(storeKey, {...quote});
    });

    fxRequests.forEach(({storeKey, fxPair}) => {
        const quote = deriveFxQuote(fxPair, quotesByCnbcSymbol);
        if (quote)
            quotesBySymbol.set(storeKey, quote);
    });

    dxyRequests.forEach(({storeKey}) => {
        const quote = deriveDxyQuote(quotesByCnbcSymbol);
        if (quote)
            quotesBySymbol.set(storeKey, quote);
    });

    return quotesBySymbol;
}

/*
 * Larger watchlists split into fixed-size batches so no single URL grows
 * unbounded. One failing batch keeps the quotes the others already returned;
 * only a pass where every batch failed rethrows, so the caller can still fall
 * back or mark stale.
 */
async function fetchQuotes(session, cnbcSymbols) {
    const quotesByCnbcSymbol = new Map();
    let lastError = null;
    let succeededCount = 0;
    const batchCount = Math.ceil(cnbcSymbols.length / CNBC_BATCH_SIZE);
    const batches = Array.from({length: batchCount}, (_unused, index) =>
        cnbcSymbols.slice(index * CNBC_BATCH_SIZE, (index + 1) * CNBC_BATCH_SIZE));
    const results = await Promise.allSettled(batches.map(batch =>
        httpGetJson(session, buildQuoteUrl(batch), {
            timeoutMessage: `Timed out after ${DEFAULT_HTTP_TIMEOUT_SECONDS}s while loading CNBC quotes.`,
            headers: {'User-Agent': CNBC_USER_AGENT},
        }).then(parseRestQuoteResponse)));

    results.forEach(result => {
        if (result.status === 'fulfilled') {
            result.value.forEach((quote, cnbcSymbol) => quotesByCnbcSymbol.set(cnbcSymbol, quote));
            succeededCount += 1;
        } else {
            lastError = result.reason;
        }
    });

    if (succeededCount === 0 && lastError)
        throw lastError;

    return quotesByCnbcSymbol;
}
