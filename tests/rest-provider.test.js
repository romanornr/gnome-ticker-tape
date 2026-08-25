import GLib from 'gi://GLib';

import {ASSET_CATEGORIES} from '../utils/asset-categories.js';
import {deriveFxQuote, parseRestQuoteResponse, refresh as refreshCnbc} from '../services/providers/cnbc.js';
import {parseQuoteResponse as parseNasdaqQuote, refresh as refreshNasdaq} from '../services/providers/nasdaq.js';
import {restProvider} from '../services/providers/rest-quotes.js';
import {fetchHyperliquidContexts} from '../utils/crypto-providers/hyperliquid/catalog.js';
import {createHyperliquidQuote} from '../utils/crypto-providers/hyperliquid/quotes.js';
import {parseKrakenTickerQuotes} from '../utils/crypto-providers/kraken/quotes.js';
import {httpGetJson} from '../utils/http.js';
import {assertDeepEqual, assertEqual} from './support/assert.js';

export async function runTests() {
    await testHttpAndEnvelopeFailures();
    testStrictQuoteParsing();
    await testCnbcBatches();
    await testNasdaqFallback();
    await testRestComposition();
    testSyntheticQuoteDates();
    await testHyperliquidPerpsOnly();
}

async function testHttpAndEnvelopeFailures() {
    const httpError = await rejectionMessage(httpGetJson(
        new FakeSession([{status: 503, body: {}}]),
        'https://example.test/unavailable'
    ));
    assertEqual(httpError.includes('HTTP 503'), true, 'The shared HTTP boundary should reject non-success status codes');
    assertDeepEqual([
        captureError(() => parseRestQuoteResponse({})),
        captureError(() => parseNasdaqQuote({})),
        captureError(() => parseKrakenTickerQuotes({})),
        await rejectionMessage(fetchHyperliquidContexts(
            new FakeSession([{status: 200, body: {}}])
        )),
    ], [
        'CNBC returned an invalid quote response.',
        'Nasdaq returned an invalid quote response.',
        'Kraken returned an invalid ticker response.',
        'Hyperliquid returned an invalid market snapshot.',
    ], 'Each provider should reject an invalid top-level response envelope');
    assertDeepEqual([
        captureError(() => parseRestQuoteResponse(null)),
        captureError(() => parseRestQuoteResponse({FormattedQuoteResult: {FormattedQuote: null}})),
        captureError(() => parseRestQuoteResponse({FormattedQuoteResult: {FormattedQuote: 'bad'}})),
        parseNasdaqQuote({data: null}),
    ], [
        'CNBC returned an invalid quote response.',
        'CNBC returned an invalid quote response.',
        'CNBC returned an invalid quote response.',
        null,
    ], 'Provider envelopes should distinguish malformed and empty responses');
}

function testStrictQuoteParsing() {
    const parsed = parseRestQuoteResponse({FormattedQuoteResult: {FormattedQuote: cnbcQuote('AAPL', '1,234.50', '2026-08-25', '4.5')}});
    assertDeepEqual([...parsed], [['AAPL', quote(1234.5, '20260825', 1230)]], 'CNBC should parse singleton quotes and prior close');
    assertDeepEqual([
        parseRestQuoteResponse({FormattedQuoteResult: {FormattedQuote: cnbcQuote('BAD', '12oops')}}).size,
        parseRestQuoteResponse({FormattedQuoteResult: {FormattedQuote: cnbcQuote('BAD', '12', '2026-02-30')}}).size,
        parseNasdaqQuote(nasdaqPayload('$12oops')),
        parseNasdaqQuote(nasdaqPayload('$12.50', 'Aug 32, 2026')),
    ], [0, 0, null, null], 'Providers should reject partial numbers and invalid dates');
}

async function testCnbcBatches() {
    const tickers = Array.from({length: 31}, (_unused, index) => ticker(`s${index}.us`));
    const partialSession = new FakeSession([
        {error: new Error('first CNBC batch failed')},
        {status: 200, body: {FormattedQuoteResult: {FormattedQuote: cnbcQuote('S30')}}},
    ]);
    const partial = await refreshCnbc(tickers, {session: partialSession});
    assertDeepEqual([partialSession.requests.length, partial.has('S30.US')], [2, true], 'CNBC should retain a later batch');
    const failure = await rejectionMessage(refreshCnbc(tickers, {session: new FakeSession([
        {error: new Error('first CNBC batch failed')},
        {error: new Error('second CNBC batch failed')},
    ])}));
    assertEqual(failure, 'first CNBC batch failed', 'CNBC should throw the first error when no batch yields a quote');

    const dxySession = new FakeSession([{status: 200, body: {FormattedQuoteResult: {FormattedQuote: cnbcQuote('.DXY', '99', '2026-08-25', '-1')}}}]);
    const dxy = await refreshCnbc([ticker('dx.f', ASSET_CATEGORIES.FX)], {session: dxySession});
    const dxyUrl = dxySession.requests[0].get_uri().to_string();
    assertDeepEqual([dxyUrl.includes('symbols=.DXY&'), dxyUrl.includes('EUR='), [...dxy]],
        [true, false, [['DX.F', quote(99, '20260825', 100)]]], 'DXY should use CNBC direct instead of a synthetic FX basket');
}

async function testNasdaqFallback() {
    const tickers = [ticker('^ndq'), ...Array.from({length: 26}, (_unused, index) => ticker(`s${index}.us`)), ticker('s0.us')];
    const session = new FakeSession(Array.from({length: 27}, () => ({status: 200, body: nasdaqPayload()})));
    const quotes = await refreshNasdaq(tickers, {session});
    const urls = session.requests.map(request => request.get_uri().to_string());
    assertDeepEqual([
        session.requests.length,
        quotes.size,
        urls.some(url => url.includes('/NDX/info?assetclass=index')),
        urls.some(url => url.includes('/S25/info?assetclass=stocks')),
    ], [27, 27, true, true], 'Nasdaq should route NDX, deduplicate symbols, and process more than 25 listings');
    const partial = await refreshNasdaq([ticker('a.us'), ticker('b.us')], {session: new FakeSession([
        {error: new Error('first Nasdaq request failed')}, {status: 200, body: nasdaqPayload()},
    ])});
    assertDeepEqual([...partial.keys()], ['B.US'], 'Nasdaq should retain successful requests');
    assertEqual(await rejectionMessage(refreshNasdaq([ticker('a.us')], {session: new FakeSession([
        {error: new Error('first Nasdaq request failed')},
    ])})), 'first Nasdaq request failed', 'Nasdaq should throw when no request yields a quote');
}

async function testRestComposition() {
    const completeSession = new FakeSession([{status: 200, body: {FormattedQuoteResult: {FormattedQuote: cnbcQuote('AAPL')}}}]);
    const complete = await restProvider.poll([ticker('aapl.us')], {session: completeSession});
    assertDeepEqual([complete.size, completeSession.requests.length], [1, 1], 'A complete CNBC pass should not run fallbacks');
    const session = new FakeSession([
        {status: 200, body: {FormattedQuoteResult: {FormattedQuote: []}}},
        {status: 200, body: nasdaqPayload()}, {status: 200, body: nasdaqPayload()},
        {status: 200, body: {result: 'success', time_last_update_unix: 1787616000, rates: {USD: 1, EUR: 0.8}}},
    ]);
    const recovered = await restProvider.poll([
        ticker('uso.us', ASSET_CATEGORIES.COMMODITY), ticker('^ndq'), ticker('eurusd', ASSET_CATEGORIES.FX),
    ], {session});
    assertDeepEqual([...recovered.keys()].sort(), ['EURUSD', 'USO.US', '^NDQ'], 'REST should combine all fallback results');
    const cnbcFailure = await rejectionMessage(restProvider.poll([ticker('a.us')], {session: new FakeSession([
        {error: new Error('CNBC failed')}, {error: new Error('Nasdaq failed')},
    ])}));
    assertEqual(cnbcFailure, 'CNBC failed', 'REST should prefer the CNBC error when every provider fails');
    const fallbackFailure = await rejectionMessage(restProvider.poll([ticker('a.us')], {session: new FakeSession([
        {status: 200, body: {FormattedQuoteResult: {FormattedQuote: []}}}, {error: new Error('Nasdaq failed')},
    ])}));
    assertEqual(fallbackFailure, 'Nasdaq failed', 'REST should throw the first fallback error after an empty CNBC pass');
}

function testSyntheticQuoteDates() {
    const fx = deriveFxQuote({baseCurrency: 'EUR', quoteCurrency: 'JPY'}, new Map([
        ['EUR=', quote(1.2, '20260825', 1.1)],
        ['JPY=', quote(150, '20260823', 149)],
    ]));
    assertEqual(fx.quoteDate, '20260823', 'Synthetic FX should use its oldest component date');
}

async function testHyperliquidPerpsOnly() {
    const session = new FakeSession([{status: 200, body: [
        {universe: [{name: 'BTC'}, {name: 'OLD', isDelisted: true}]},
        [{midPx: '104321.50'}, {midPx: '1'}],
    ]}]);
    const contexts = await fetchHyperliquidContexts(session);
    assertDeepEqual({
        requests: session.requests.length,
        contexts: [...contexts].map(([symbol, ctx]) => [symbol, ctx.midPx]),
        quote: createHyperliquidQuote(contexts.get('BTC')).price,
    }, {
        requests: 1,
        contexts: [['BTC', '104321.50']],
        quote: 104321.5,
    }, 'Hyperliquid discovery should return raw perpetual contexts and exclude delisted markets');

    assertEqual(await rejectionMessage(fetchHyperliquidContexts(new FakeSession([{status: 200, body: [
        {universe: [{name: 'BTC'}]}, [],
    ]}]))), 'Hyperliquid returned an invalid market snapshot.',
    'Hyperliquid should reject mismatched universe and context arrays');
}

const ticker = (symbol, assetCategory = ASSET_CATEGORIES.EQUITY) => ({symbol, assetCategory});
const cnbcQuote = (symbol, last = '100', last_time = '2026-08-25', change = '1') => ({symbol, last, last_time, change});
const nasdaqPayload = (lastSalePrice = '$100', lastTradeTimestamp = 'Aug 25, 2026') =>
    ({data: {primaryData: {lastSalePrice, lastTradeTimestamp, netChange: '1'}}});
const quote = (price, quoteDate, previousClose) => ({price, quoteDate, previousClose});

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
        message.get_status = () => response.status ?? 200;
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
