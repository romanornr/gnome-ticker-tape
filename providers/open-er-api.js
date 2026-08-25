import {DEFAULT_HTTP_TIMEOUT_SECONDS, httpGetJson} from './http.js';
import {parseFxPairSymbol} from './cnbc/symbols.js';

const ER_API_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

/*
 * open.er-api.com is the FX fallback when CNBC's spot vector is unavailable.
 * It publishes one daily USD rate table covering every catalog currency, so a
 * single request derives any pair — at daily reference freshness, which the
 * quote date reflects so stale styling applies naturally.
 */
export async function refresh(tickers, {session}) {
    const fxRequests = tickers
        .map(ticker => ({
            storeKey: ticker.symbol.toUpperCase(),
            fxPair: parseFxPairSymbol(ticker.symbol),
        }))
        .filter(request => request.fxPair !== null);

    if (!session || fxRequests.length === 0)
        return new Map();

    const payload = await httpGetJson(session, ER_API_ENDPOINT, {
        timeoutMessage: `Timed out after ${DEFAULT_HTTP_TIMEOUT_SECONDS}s while loading fallback FX rates.`,
    });

    return deriveFxQuotes(payload, fxRequests);
}

/* Rates arrive as units-per-USD, so any pair reduces to rates[quote] / rates[base]. */
function deriveFxQuotes(payload, fxRequests) {
    const quotesBySymbol = new Map();
    if (payload?.result !== 'success' || !payload.rates ||
        typeof payload.rates !== 'object' || Array.isArray(payload.rates))
        throw new Error('Fallback FX provider returned an invalid rate table.');

    const rates = payload.rates;
    const quoteDate = normalizeUpdateTimestamp(payload.time_last_update_unix);
    if (quoteDate === '')
        throw new Error('Fallback FX provider returned an invalid update time.');

    fxRequests.forEach(({storeKey, fxPair}) => {
        const baseRate = rates[fxPair.baseCurrency];
        const quoteRate = rates[fxPair.quoteCurrency];
        if (!Number.isFinite(baseRate) || baseRate <= 0 || !Number.isFinite(quoteRate) || quoteRate <= 0)
            return;

        quotesBySymbol.set(storeKey, {
            price: quoteRate / baseRate,
            quoteDate,
            previousClose: null,
        });
    });

    return quotesBySymbol;
}

function normalizeUpdateTimestamp(unixSeconds) {
    if (!Number.isFinite(unixSeconds) || unixSeconds <= 0)
        return '';

    return new Date(unixSeconds * 1000).toISOString().slice(0, 10).replaceAll('-', '');
}
