import {ASSET_CATEGORIES, CRYPTO_PROVIDERS, getTickerMarketSessionPolicy} from '../utils/asset-categories.js';
import {MARKET_SESSION_IDS} from '../utils/market-sessions.js';
import {
    buildTickerConfig,
    getCatalogMatches,
    resolveSelectedCryptoTicker,
    validateTickerDraft,
} from '../utils/prefs/ticker-dialog-state.js';
import {DEFAULT_TICKERS, loadTickerConfigs} from '../utils/settings.js';
import {getCuratedTickersForCategory} from '../utils/ticker-catalog.js';
import {serializeTickerConfig} from '../utils/ticker-config.js';
import {TickerDialogController} from '../utils/prefs/ticker-dialog-controller.js';
import {assertDeepEqual, assertEqual} from './support/assert.js';

const fakeSettings = serialized => ({get_string: () => serialized});

export async function runTests() {
    const legacyCases = [
        [{symbol: 'btc.v', marketType: 'always-open', liveSymbol: 'BTC/USD'}, ASSET_CATEGORIES.CRYPTO, MARKET_SESSION_IDS.ALWAYS_OPEN],
        [{symbol: 'btcusd', marketType: 'always_open'}, ASSET_CATEGORIES.CRYPTO, MARKET_SESSION_IDS.ALWAYS_OPEN],
        [{symbol: 'eurusd', marketType: 'weekday-session'}, ASSET_CATEGORIES.FX, MARKET_SESSION_IDS.WEEKDAY_24H],
        [{symbol: 'eurusd', marketType: 'weekday_session'}, ASSET_CATEGORIES.FX, MARKET_SESSION_IDS.WEEKDAY_24H],
        [{symbol: 'aapl.us', marketType: 'us-session'}, ASSET_CATEGORIES.EQUITY, MARKET_SESSION_IDS.US_EQUITY_EXTENDED],
        [{symbol: 'aapl.us', marketType: 'us_session'}, ASSET_CATEGORIES.EQUITY, MARKET_SESSION_IDS.US_EQUITY_EXTENDED],
        [{symbol: 'legacy.us', assetCategory: 'us-equity'}, ASSET_CATEGORIES.EQUITY, MARKET_SESSION_IDS.US_EQUITY_EXTENDED],
        [{symbol: 'legacy.us', assetCategory: 'us_equity'}, ASSET_CATEGORIES.EQUITY, MARKET_SESSION_IDS.US_EQUITY_EXTENDED],
        [{symbol: 'legacy.us', assetCategory: 'us-etf'}, ASSET_CATEGORIES.ETF, MARKET_SESSION_IDS.US_EQUITY_EXTENDED],
        [{symbol: 'legacy.us', assetCategory: 'us_etf'}, ASSET_CATEGORIES.ETF, MARKET_SESSION_IDS.US_EQUITY_EXTENDED],
        [{symbol: 'gld.us', assetCategory: ASSET_CATEGORIES.COMMODITY, marketSessionId: MARKET_SESSION_IDS.WEEKDAY_24H}, ASSET_CATEGORIES.COMMODITY, MARKET_SESSION_IDS.US_EQUITY_EXTENDED],
        [{symbol: 'asml.nl', assetCategory: ASSET_CATEGORIES.EQUITY}, ASSET_CATEGORIES.EQUITY, MARKET_SESSION_IDS.EUROPE_EQUITY_CASH],
    ];

    assertDeepEqual(legacyCases.map(([rawTicker]) => {
        const ticker = loadTickerConfigs(fakeSettings(JSON.stringify([{label: 'Saved', ...rawTicker}])))[0];
        const serialized = serializeTickerConfig(ticker);
        return [ticker.assetCategory, ticker.marketSessionId, serialized.marketSessionId];
    }), legacyCases.map(([, assetCategory, marketSessionId]) => [assetCategory, marketSessionId, marketSessionId]),
    'Supported persisted aliases should normalize and serialize through one stable boundary');

    const originalLogError = globalThis.logError;
    globalThis.logError = () => {};
    let settingsFallbacks;
    try {
        settingsFallbacks = [
            loadTickerConfigs(fakeSettings('[]')).length,
            loadTickerConfigs(fakeSettings('')).length > 0,
            loadTickerConfigs(fakeSettings('not json')).length > 0,
            loadTickerConfigs(fakeSettings('[{"label":""}]')).length > 0,
        ];
    } finally {
        globalThis.logError = originalLogError;
    }
    assertDeepEqual(settingsFallbacks, [0, true, true, true],
        'An explicit empty list should remain empty while missing or invalid settings restore defaults');

    const curatedTickers = Object.values(ASSET_CATEGORIES).flatMap(getCuratedTickersForCategory);
    assertEqual([...curatedTickers, ...DEFAULT_TICKERS].every(ticker =>
        ticker.marketSessionId === getTickerMarketSessionPolicy(ticker).defaultMarketSessionId), true,
    'Curated and default tickers should materialize the shared session policy');

    const cryptoCatalog = [{
        label: 'BTC/USD', symbol: 'btcusd', liveSymbol: 'BTC/USD',
        priceDecimals: 0, assetCategory: ASSET_CATEGORIES.CRYPTO,
        marketSessionId: MARKET_SESSION_IDS.ALWAYS_OPEN, cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
    }];
    const resolvedTicker = resolveSelectedCryptoTicker({
        assetCategory: ASSET_CATEGORIES.CRYPTO,
        cryptoCatalog,
        cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
        labelText: '',
        symbolText: 'BTC/USD',
    });
    const catalogMatches = getCatalogMatches(ASSET_CATEGORIES.CRYPTO, 'BTC', cryptoCatalog, CRYPTO_PROVIDERS.KRAKEN);
    assertDeepEqual({
        resolvedSymbol: resolvedTicker.liveSymbol,
        matchCount: catalogMatches.length,
        validMessage: validateTickerDraft('', 'BTC/USD', {
            assetCategory: ASSET_CATEGORIES.CRYPTO,
            cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
            resolvedCryptoTicker: resolvedTicker,
            hasCryptoCatalogMatches: true,
        }),
        invalidMessage: validateTickerDraft('', 'UNKNOWN/USD', {
            assetCategory: ASSET_CATEGORIES.CRYPTO,
            cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
            resolvedCryptoTicker: null,
            hasCryptoCatalogMatches: false,
        }),
    }, {
        resolvedSymbol: 'BTC/USD',
        matchCount: 1,
        validMessage: '',
        invalidMessage: 'Choose a Kraken-supported crypto pair.',
    }, 'Crypto dialog state should resolve supported markets and reject unknown ones');

    assertDeepEqual(Object.entries(buildTickerConfig({
        initialTicker: {},
        labelText: '',
        symbolText: 'BTC/USD',
        priceDecimals: 0,
        panelSide: 'right',
        assetCategory: ASSET_CATEGORIES.CRYPTO,
        marketSessionId: MARKET_SESSION_IDS.ALWAYS_OPEN,
        cryptoProvider: CRYPTO_PROVIDERS.KRAKEN,
        resolvedCryptoTicker: resolvedTicker,
        cryptoCatalog,
    })).sort(), Object.entries({...cryptoCatalog[0], panelSide: 'right'}).sort(),
    'A validated dialog draft should produce the complete saved ticker config');

    const deferredVerification = Promise.withResolvers();
    const verificationMessages = [];
    const controller = Object.assign(Object.create(TickerDialogController.prototype), {
        activeAssetCategory: ASSET_CATEGORIES.EQUITY, lastVerifiedSymbol: '',
        verificationRequestId: 0, verifyInProgress: false,
        symbolValueLabel: {label: 'aapl.us'},
        verifySymbol: () => deferredVerification.promise,
        _setVerificationMessage: message => verificationMessages.push(message),
        _updateSaveSensitivity() {},
        _updateVerifyButtonSensitivity() {},
    });
    const verificationRequest = controller._runSymbolVerification();
    controller.symbolValueLabel.label = 'msft.us';
    controller._handleSymbolTextChanged();
    deferredVerification.resolve({symbol: 'aapl.us', quoteDate: '2026-08-25'});
    await verificationRequest;
    assertDeepEqual([
        controller.verificationRequestId,
        controller.verifyInProgress,
        controller.lastVerifiedSymbol,
        verificationMessages.at(-1),
    ], [2, false, '', ''], 'A stale verification response should not update an edited symbol');
}
