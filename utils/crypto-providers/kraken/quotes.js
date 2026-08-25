import {httpGetJson} from '../../http.js';

const KRAKEN_REST_TICKER_URL = 'https://api.kraken.com/0/public/Ticker';

function buildKrakenTickerUrl(liveSymbols) {
    return `${KRAKEN_REST_TICKER_URL}?pair=${liveSymbols.map(encodeURIComponent).join(',')}`;
}

export async function fetchKrakenTickerQuotes(session, liveSymbols) {
    if (liveSymbols.length === 0) return new Map();

    const payload = await httpGetJson(session, buildKrakenTickerUrl(liveSymbols));
    return parseKrakenTickerQuotes(payload);
}

/*
 * REST ticker rows are normalized into the same quote shape as websocket
 * updates. REST has no per-quote timestamp, so the fetch time stands in, and
 * today's open price stands in for the websocket feed's 24h-change-derived
 * previous close.
 */
export function parseKrakenTickerQuotes(payload, timestamp = new Date().toISOString()) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.error))
        throw new Error('Kraken returned an invalid ticker response.');

    if (payload.error.length > 0)
        throw new Error(`Kraken ticker request failed: ${payload.error.join(', ')}`);
    if (!payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result))
        throw new Error('Kraken returned an invalid ticker response.');

    const quoteDate = normalizeKrakenTimestampDate(timestamp);
    const quotesByPair = new Map();

    Object.entries(payload.result).forEach(([pair, entry]) => {
        const price = Number.parseFloat(`${entry?.c?.[0] ?? ''}`);
        const open = Number.parseFloat(`${entry?.o ?? ''}`);

        if (!Number.isFinite(price) || price <= 0 || quoteDate === '') return;

        quotesByPair.set(pair, {
            price,
            quoteDate,
            previousClose: Number.isFinite(open) && open > 0 ? open : null,
        });
    });

    return quotesByPair;
}

export function createKrakenQuote(entry) {
    const price = Number.parseFloat(`${entry?.last ?? ''}`);
    const quoteDate = normalizeKrakenTimestampDate(entry?.timestamp ?? '');
    const change = Number.parseFloat(`${entry?.change ?? ''}`);
    const changePct = Number.parseFloat(`${entry?.change_pct ?? ''}`);

    if (!Number.isFinite(price) || price <= 0 || quoteDate === '') return null;

    return {price, quoteDate, previousClose: deriveKrakenPreviousClose(price, change, changePct)};
}

function deriveKrakenPreviousClose(price, change, changePct) {
    if (Number.isFinite(change)) {
        const previousClose = price - change;
        if (Number.isFinite(previousClose) && previousClose > 0) return previousClose;
    }

    if (Number.isFinite(changePct) && changePct > -100) {
        const previousClose = price / (1 + (changePct / 100));
        if (Number.isFinite(previousClose) && previousClose > 0) return previousClose;
    }

    return null;
}

function normalizeKrakenTimestampDate(timestampText) {
    const normalized = timestampText.slice(0, 10).replaceAll('-', '');
    return /^\d{8}$/.test(normalized) ? normalized : '';
}
