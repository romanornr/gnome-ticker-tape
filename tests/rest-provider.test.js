import GLib from 'gi://GLib';

import {deriveDxyQuote, deriveFxQuote, parseRestQuoteResponse} from '../services/providers/cnbc.js';
import {parseQuoteResponse as parseNasdaqQuote} from '../services/providers/nasdaq.js';
import {fetchHyperliquidMarketSnapshots} from '../utils/crypto-providers/hyperliquid/catalog.js';
import {parseKrakenTickerQuotes} from '../utils/crypto-providers/kraken/quotes.js';
import {httpGetJson} from '../utils/http.js';
import {assertDeepEqual, assertEqual} from './support/assert.js';

export async function runTests() {
    await testHttpAndEnvelopeFailures();
    testSyntheticQuoteDates();
    await testHyperliquidPerpsOnly();
}

async function testHttpAndEnvelopeFailures() {
    const httpError = await rejectionMessage(httpGetJson(
        new FakeSession([{status: 503, body: {}}]),
        'https://example.test/unavailable'
    ));
    assertEqual(httpError.includes('HTTP 503'), true,
        'The shared HTTP boundary should reject non-success status codes');

    assertDeepEqual([
        captureError(() => parseRestQuoteResponse({})),
        captureError(() => parseNasdaqQuote({})),
        captureError(() => parseKrakenTickerQuotes({})),
        await rejectionMessage(fetchHyperliquidMarketSnapshots(
            new FakeSession([{status: 200, body: {}}])
        )),
    ], [
        'CNBC returned an invalid quote response.',
        'Nasdaq returned an invalid quote response.',
        'Kraken returned an invalid ticker response.',
        'Hyperliquid returned an invalid market snapshot.',
    ], 'Each provider should reject an invalid top-level response envelope');
}

function testSyntheticQuoteDates() {
    const fx = deriveFxQuote({baseCurrency: 'EUR', quoteCurrency: 'JPY'}, new Map([
        ['EUR=', quote(1.2, '20260825', 1.1)],
        ['JPY=', quote(150, '20260823', 149)],
    ]));
    const dxy = deriveDxyQuote(new Map([
        ['EUR=', quote(1.2, '20260825', 1.1)],
        ['JPY=', quote(150, '20260824', 149)],
        ['GBP=', quote(1.3, '20260822', 1.2)],
        ['CAD=', quote(1.4, '20260825', 1.3)],
        ['SEK=', quote(10, '20260825', 9.9)],
        ['CHF=', quote(0.8, '20260825', 0.79)],
    ]));

    assertDeepEqual([fx.quoteDate, dxy.quoteDate], ['20260823', '20260822'],
        'Synthetic quotes should use the oldest component date');
}

async function testHyperliquidPerpsOnly() {
    const session = new FakeSession([{status: 200, body: [
        {universe: [{name: 'BTC'}, {name: 'OLD', isDelisted: true}]},
        [{midPx: '104321.50'}, {midPx: '1'}],
    ]}]);
    const markets = await fetchHyperliquidMarketSnapshots(session);

    assertDeepEqual({
        requests: session.requests.length,
        markets: markets.map(({label, symbol, liveSymbol, quote: quoteCurrency}) =>
            ({label, symbol, liveSymbol, quote: quoteCurrency})),
    }, {
        requests: 1,
        markets: [{label: 'BTC Perp', symbol: 'btc', liveSymbol: 'BTC', quote: 'USD'}],
    }, 'Hyperliquid discovery should issue one perpetual-market request and exclude delisted markets');
}

function quote(price, quoteDate, previousClose) {
    return {price, quoteDate, previousClose};
}

function captureError(callback) {
    try {
        callback();
        return '';
    } catch (error) {
        return error.message;
    }
}

async function rejectionMessage(promise) {
    try {
        await promise;
        return '';
    } catch (error) {
        return error.message;
    }
}

class FakeSession {
    constructor(responses) {
        this.responses = responses;
        this.requests = [];
    }

    send_and_read_async(message, _priority, _cancellable, callback) {
        const response = this.responses.shift();
        this.requests.push(message);
        message.get_status = () => response.status;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            callback(this, response);
            return GLib.SOURCE_REMOVE;
        });
    }

    send_and_read_finish(response) {
        if (response.error)
            throw response.error;

        const body = typeof response.body === 'string'
            ? response.body
            : JSON.stringify(response.body);
        return GLib.Bytes.new(new TextEncoder().encode(body));
    }
}
