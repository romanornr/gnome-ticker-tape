import {isLiveCryptoTicker} from '../utils/asset-categories.js';

import {refresh as refreshCnbcQuotes} from './cnbc/quotes.js';
import {refresh as refreshNasdaqQuotes} from './nasdaq.js';
import {refresh as refreshFallbackFxQuotes} from './open-er-api.js';

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

    const results = await Promise.allSettled([
        refreshNasdaqQuotes(missingTickers, context),
        refreshFallbackFxQuotes(missingTickers, context),
    ]);
    results.filter(result => result.status === 'fulfilled').forEach(result =>
        result.value.forEach((quote, storeKey) => quotesBySymbol.set(storeKey, quote)));

    if (quotesBySymbol.size === 0) {
        if (cnbcError) throw cnbcError;
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
    }

    return quotesBySymbol;
}

export const marketQuotesProvider = {
    id: 'market',
    ownsTicker: ticker => !isLiveCryptoTicker(ticker),
    selectPollTickers: tickers => tickers,
    poll: refresh,
};
