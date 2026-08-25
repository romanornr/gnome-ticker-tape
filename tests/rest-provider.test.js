import GLib from 'gi://GLib';

import {ASSET_CATEGORIES} from '../utils/asset-categories.js';
import {
    refresh as refreshRestQuotes,
    verifySymbol,
} from '../services/providers/rest-quotes.js';
import {assertDeepEqual, assertEqual} from './support/assert.js';

const RATE_TABLE = {
    result: 'success',
    time_last_update_unix: 1785715352,
    rates: {USD: 1, EUR: 0.8, JPY: 160},
};

export async function runTests() {
    await testPrimaryComposition();
    await testFallbackComposition();
    await testPartialFailurePolicy();
    await testVerificationContract();
}

async function testPrimaryComposition() {
    const session = new RoutingFakeSession([
        ['quote.cnbc.com', cnbcPayload([
            quote('AAPL', '100.5'),
            quote('EUR=', '1.1553', '1.15'),
            quote('JPY=', '157.62', '157.55'),
            quote('GBP=', '1.3464', '1.34'),
            quote('CAD=', '1.4011', '1.40'),
            quote('SEK=', '9.4832', '9.49'),
            quote('CHF=', '0.8067', '0.807'),
            {symbol: 'ASML-NL', code: 1},
        ])],
    ]);
    const quotes = await refreshRestQuotes([
        ticker('aapl.us', ASSET_CATEGORIES.EQUITY),
        ticker('eurusd', ASSET_CATEGORIES.FX),
        ticker('dx.f', ASSET_CATEGORIES.FX),
        ticker('asml.nl', ASSET_CATEGORIES.EQUITY),
    ], {session});

    assertEqual(quotes.get('AAPL.US').price, 100.5,
        'The primary pass should return direct listings');
    assertEqual(quotes.get('EURUSD').price, 1.1553,
        'The primary pass should derive FX pairs from spot legs');
    assertEqual(Number.isFinite(quotes.get('DX.F').price), true,
        'The primary pass should derive DXY from its complete currency basket');
    assertEqual(quotes.has('ASML.NL'), false,
        'A missed foreign listing should stay missing rather than resolve to an ADR');
    assertEqual(session.requestedUrls.some(url => url.includes('nasdaq.com')), false,
        'A foreign listing miss should never be routed to Nasdaq');
}

async function testFallbackComposition() {
    const session = new RoutingFakeSession([
        ['quote.cnbc.com', cnbcPayload([quote('AAPL', '100.5')])],
        ['api.nasdaq.com', nasdaqPayload('$750', '+10')],
        ['open.er-api.com', RATE_TABLE],
    ]);
    const quotes = await refreshRestQuotes([
        ticker('aapl.us', ASSET_CATEGORIES.EQUITY),
        ticker('spy.us', ASSET_CATEGORIES.ETF),
        ticker('eurusd', ASSET_CATEGORIES.FX),
    ], {session});

    assertDeepEqual(Array.from(quotes.entries()).sort(), [
        ['AAPL.US', {price: 100.5, quoteDate: '20260803', previousClose: null}],
        ['EURUSD', {price: 1.25, quoteDate: '20260803', previousClose: null}],
        ['SPY.US', {price: 750, quoteDate: '20260803', previousClose: 740}],
    ], 'One refresh should compose CNBC, Nasdaq, and FX-table results');
}

async function testPartialFailurePolicy() {
    const tickers = [
        ...Array.from({length: 30}, (_, index) => ticker(`missing${index}.nl`, ASSET_CATEGORIES.EQUITY)),
        ticker('asml.nl', ASSET_CATEGORIES.EQUITY),
    ];
    const partialSession = new RoutingFakeSession([
        ['symbols=ASML-NL&', cnbcPayload([quote('ASML-NL', '700')])],
        ['quote.cnbc.com', new Error('first batch failed')],
    ]);
    const partialQuotes = await refreshRestQuotes(tickers, {session: partialSession});

    assertEqual(partialQuotes.get('ASML.NL').price, 700,
        'A failed batch should not discard a successful batch');
    assertEqual(partialSession.requestedUrls.filter(url => url.includes('quote.cnbc.com')).length, 2,
        'More than 30 provider symbols should be split into batches');

    const message = await refreshRestQuotes([ticker('asml.nl', ASSET_CATEGORIES.EQUITY)], {
        session: new RoutingFakeSession([['quote.cnbc.com', new Error('CNBC unavailable')]]),
    }).then(() => '', error => error.message);
    assertEqual(message, 'CNBC unavailable',
        'An unrecoverable primary failure should reach the service health boundary');
}

async function testVerificationContract() {
    const cases = [
        {
            symbol: 'aapl.us',
            category: ASSET_CATEGORIES.EQUITY,
            routes: [['quote.cnbc.com', cnbcPayload([quote('AAPL', '100.5')])]],
            expected: {symbol: 'aapl.us', quoteDate: '2026-08-03'},
        },
        {
            symbol: 'spy.us',
            category: ASSET_CATEGORIES.ETF,
            routes: [
                ['quote.cnbc.com', cnbcPayload([{symbol: 'SPY', code: 1}])],
                ['api.nasdaq.com', nasdaqPayload('$750', '+10')],
            ],
            expected: {symbol: 'spy.us', quoteDate: '2026-08-03'},
        },
        {
            symbol: 'eurjpy',
            category: ASSET_CATEGORIES.FX,
            routes: [
                ['quote.cnbc.com', cnbcPayload([])],
                ['open.er-api.com', RATE_TABLE],
            ],
            expected: {symbol: 'eurjpy', quoteDate: '2026-08-03'},
        },
        {
            symbol: 'zzzq.nl',
            category: ASSET_CATEGORIES.EQUITY,
            routes: [['quote.cnbc.com', cnbcPayload([{symbol: 'ZZZQ-NL', code: 1}])]],
            error: 'Could not verify zzzq.nl. No quote data was returned by CNBC.',
        },
        {
            symbol: 'bad.xx',
            category: ASSET_CATEGORIES.EQUITY,
            routes: [],
            error: 'Could not verify bad.xx. The symbol format is not supported.',
        },
    ];

    for (const testCase of cases) {
        const result = await verifySymbol(
            new RoutingFakeSession(testCase.routes),
            testCase.symbol,
            testCase.category
        ).catch(error => error.message);

        if (testCase.error) {
            assertEqual(result, testCase.error,
                `Verification should preserve the user-facing error for ${testCase.symbol}`);
        } else {
            assertDeepEqual(result, testCase.expected,
                `Verification should mirror runtime resolution for ${testCase.symbol}`);
        }
    }
}

function ticker(symbol, assetCategory) {
    return {symbol, assetCategory};
}

function quote(symbol, last, previousClose = null) {
    return {
        symbol,
        last,
        last_time: '2026-08-03',
        previous_day_closing: previousClose,
    };
}

function cnbcPayload(quotes) {
    return {FormattedQuoteResult: {FormattedQuote: quotes}};
}

function nasdaqPayload(lastSalePrice, netChange) {
    return {data: {primaryData: {
        lastSalePrice,
        netChange,
        lastTradeTimestamp: 'Aug 3, 2026 12:27 PM ET',
    }}};
}

class RoutingFakeSession {
    constructor(routes) {
        this.routes = routes;
        this.requestedUrls = [];
    }

    send_and_read_async(message, _priority, _cancellable, callback) {
        const url = message.get_uri().to_string();
        this.requestedUrls.push(url);
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            callback(this, url);
            return GLib.SOURCE_REMOVE;
        });
    }

    send_and_read_finish(url) {
        const route = this.routes.find(([needle]) => url.includes(needle));
        if (!route)
            throw new Error(`No fake route for ${url}`);
        if (route[1] instanceof Error)
            throw route[1];

        return GLib.Bytes.new(new TextEncoder().encode(JSON.stringify(route[1])));
    }
}
