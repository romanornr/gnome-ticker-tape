import {
    ASSET_CATEGORIES,
    CRYPTO_PROVIDERS,
    getTickerMarketSessionId,
} from '../utils/asset-categories.js';
import {HyperliquidProvider} from '../providers/hyperliquid/provider.js';
import {KrakenProvider} from '../providers/kraken/provider.js';
import {marketQuotesProvider} from '../providers/market-quotes.js';
import {MARKET_SESSION_IDS} from '../utils/market-sessions.js';
import {matchCuratedTickers} from '../utils/ticker-catalog.js';
import {normalizeTickerConfig, serializeTickerConfig} from '../utils/ticker-config.js';
import {assertDeepEqual} from './support/assert.js';

export function runTests() {
    testCurrentConfigAndSessions();
    testSearchAndProviderIsolation();
}

function testCurrentConfigAndSessions() {
    const cases = [
        [ticker('ASML', 'asml.nl', ASSET_CATEGORIES.EQUITY), MARKET_SESSION_IDS.EUROPE_EQUITY_CASH],
        [ticker('USO', 'uso.us', ASSET_CATEGORIES.COMMODITY), MARKET_SESSION_IDS.US_EQUITY_EXTENDED],
        [ticker('Gold', 'xauusd', ASSET_CATEGORIES.COMMODITY), MARKET_SESSION_IDS.WEEKDAY_24H],
        [ticker('EUR/USD', 'eurusd', ASSET_CATEGORIES.FX), MARKET_SESSION_IDS.WEEKDAY_24H],
        [{
            ...ticker('BTC', 'btcusd', ASSET_CATEGORIES.CRYPTO),
            cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
            liveSymbol: ' BTC/USD ',
        }, MARKET_SESSION_IDS.ALWAYS_OPEN],
    ];

    assertDeepEqual(cases.map(([raw, expectedSession]) => {
        const normalized = normalizeTickerConfig({...raw, marketSessionId: 'ignored'});
        return [
            normalized.marketSessionId,
            getTickerMarketSessionId(normalized),
            Object.hasOwn(serializeTickerConfig(normalized), 'marketSessionId'),
            expectedSession,
        ];
    }), cases.map(([, expected]) => [expected, expected, false, expected]),
    'Current ticker config should derive exchange sessions and omit them from persistence');
}

function testSearchAndProviderIsolation() {
    const cryptoCatalog = [
        cryptoCatalogEntry('BTC/USD', 'btcusd', CRYPTO_PROVIDERS.KRAKEN),
        cryptoCatalogEntry('BTC Perp', 'btc', CRYPTO_PROVIDERS.HYPERLIQUID),
    ];
    const kraken = provider(KrakenProvider);
    const hyperliquid = provider(HyperliquidProvider);
    const krakenTicker = cryptoCatalog[0];
    const hyperliquidTicker = cryptoCatalog[1];

    assertDeepEqual({
        legacyAccepted: normalizeTickerConfig(ticker('Old', 'old.us', 'us-equity')) !== null,
        descriptionMatches: matchCuratedTickers(ASSET_CATEGORIES.EQUITY, 'individual stocks').length,
        krakenMatches: matchCuratedTickers(ASSET_CATEGORIES.CRYPTO, 'btc', {
            cryptoCatalog,
            cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
        }).map(entry => entry.cryptoProvider),
        hyperliquidMatches: matchCuratedTickers(ASSET_CATEGORIES.CRYPTO, 'btc', {
            cryptoCatalog,
            cryptoProvider: CRYPTO_PROVIDERS.HYPERLIQUID,
        }).map(entry => entry.cryptoProvider),
        ownership: [
            marketQuotesProvider.ownsTicker(ticker('AAPL', 'aapl.us', ASSET_CATEGORIES.EQUITY)),
            marketQuotesProvider.ownsTicker(krakenTicker),
            kraken.ownsTicker(krakenTicker),
            kraken.ownsTicker(hyperliquidTicker),
            hyperliquid.ownsTicker(hyperliquidTicker),
        ],
    }, {
        legacyAccepted: false,
        descriptionMatches: 0,
        krakenMatches: [CRYPTO_PROVIDERS.KRAKEN],
        hyperliquidMatches: [CRYPTO_PROVIDERS.HYPERLIQUID],
        ownership: [true, false, true, false, true],
    }, 'Search and runtime providers should isolate crypto catalogs by provider');
}

function ticker(label, symbol, assetCategory) {
    return {label, symbol, assetCategory, priceDecimals: 2, panelSide: 'right'};
}

function cryptoCatalogEntry(label, symbol, cryptoProvider) {
    return {
        ...ticker(label, symbol, ASSET_CATEGORIES.CRYPTO),
        cryptoProvider,
        liveSymbol: cryptoProvider === CRYPTO_PROVIDERS.KRAKEN ? 'BTC/USD' : 'BTC',
        keywords: ['bitcoin'],
    };
}

function provider(Provider) {
    return new Provider({uuid: 'test', onQuotes() {}, onStale() {}});
}
