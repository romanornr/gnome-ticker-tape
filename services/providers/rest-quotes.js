import {isLiveCryptoTicker} from '../../utils/asset-categories.js';

import {refresh as refreshCnbcQuotes} from './cnbc.js';
import {refresh as refreshNasdaqQuotes} from './nasdaq.js';
import {refresh as refreshFallbackFxQuotes} from './open-er-api.js';

/* CNBC is primary; Nasdaq and the daily FX table fill only missing quotes. */
async function refresh(tickers, context) {
    let quotesBySymbol = new Map();
    let cnbcError = null;

    try {
        quotesBySymbol = await refreshCnbcQuotes(tickers, context);
    } catch (error) {
        cnbcError = error;
    }

    const missingTickers = tickers.filter(ticker => !quotesBySymbol.has(ticker.symbol.toUpperCase()));
    if (missingTickers.length === 0)
        return quotesBySymbol;

    await runFallbacks(missingTickers, context, quotesBySymbol);

    if (quotesBySymbol.size === 0 && cnbcError)
        throw cnbcError;

    return quotesBySymbol;
}

export const restProvider = {
    id: 'rest',
    ownsTicker: ticker => !isLiveCryptoTicker(ticker),
    selectPollTickers: tickers => tickers,
    poll: refresh,
};

async function runFallbacks(missingTickers, context, quotesBySymbol) {
    const results = await Promise.allSettled([
        refreshNasdaqQuotes(missingTickers, context),
        refreshFallbackFxQuotes(missingTickers, context),
    ]);
    results.filter(result => result.status === 'fulfilled').forEach(result =>
        result.value.forEach((quote, storeKey) => quotesBySymbol.set(storeKey, quote)));
}
