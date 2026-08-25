import {ASSET_CATEGORIES} from '../asset-categories.js';

const FX_CURRENCY_DEFINITIONS = [
    {code: 'AUD', name: 'Australian dollar'},
    {code: 'BRL', name: 'Brazilian real'},
    {code: 'CAD', name: 'Canadian dollar'},
    {code: 'CHF', name: 'Swiss franc'},
    {code: 'CZK', name: 'Czech koruna'},
    {code: 'DKK', name: 'Danish krone'},
    {code: 'EUR', name: 'Euro'},
    {code: 'GBP', name: 'British pound'},
    {code: 'HUF', name: 'Hungarian forint'},
    {code: 'INR', name: 'Indian rupee'},
    {code: 'JPY', name: 'Japanese yen'},
    {code: 'MXN', name: 'Mexican peso'},
    {code: 'NOK', name: 'Norwegian krone'},
    {code: 'NZD', name: 'New Zealand dollar'},
    {code: 'PLN', name: 'Polish zloty'},
    {code: 'RUB', name: 'Russian ruble'},
    {code: 'SEK', name: 'Swedish krona'},
    {code: 'SGD', name: 'Singapore dollar'},
    {code: 'TRY', name: 'Turkish lira'},
    {code: 'USD', name: 'U.S. dollar'},
    {code: 'ZAR', name: 'South African rand'},
];

/* This turns the supported currency matrix into searchable prefs entries without hand-maintaining hundreds of pairs. */
function buildFxTickerDefinition(baseCurrency, quoteCurrency) {
    const label = `${baseCurrency.code}/${quoteCurrency.code}`;
    const symbol = `${baseCurrency.code}${quoteCurrency.code}`.toLowerCase();
    const priceDecimals = quoteCurrency.code === 'JPY' ? 2 : 4;

    if (label === 'AUD/USD') {
        return {
            label,
            symbol,
            priceDecimals,
            keywords: ['aussie', 'audusd', 'australian dollar u.s. dollar'],
        };
    }

    return {
        label,
        symbol,
        priceDecimals,
        keywords: [
            symbol,
            `${baseCurrency.name.toLowerCase()} ${quoteCurrency.name.toLowerCase()}`,
        ],
    };
}

const FX_TICKER_DEFINITIONS = FX_CURRENCY_DEFINITIONS.flatMap(baseCurrency => FX_CURRENCY_DEFINITIONS
    .filter(quoteCurrency => quoteCurrency.code !== baseCurrency.code)
    .map(quoteCurrency => buildFxTickerDefinition(baseCurrency, quoteCurrency)))
    .concat([{
        label: 'DXY',
        symbol: 'dx.f',
        priceDecimals: 2,
        keywords: ['dollar index', 'usd index'],
    }])
    .sort((left, right) => left.label.localeCompare(right.label));

export const FX_TICKERS = FX_TICKER_DEFINITIONS.map(entry => ({
    assetCategory: ASSET_CATEGORIES.FX,
    label: entry.label,
    symbol: entry.symbol,
    priceDecimals: entry.priceDecimals,
    keywords: [...entry.keywords],
}));
