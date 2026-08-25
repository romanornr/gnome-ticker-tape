import {buildEntries, clearPriceFlash} from '../services/entry-model.js';
import {QuoteStore} from '../services/quote-store.js';
import {getDensityFontScale, getSharedDensityFontScale} from '../utils/display-density.js';
import {DEFAULT_DISPLAY_SETTINGS, FONT_PRESETS} from '../utils/display-settings.js';
import {POSITIVE_COLOR} from '../utils/format.js';
import {MARKET_SESSION_IDS} from '../utils/market-sessions.js';
import {assertDeepEqual} from './support/assert.js';

const TICKER = {
    label: 'SPX',
    symbol: '^spx',
    priceDecimals: 0,
    marketSessionId: MARKET_SESSION_IDS.US_EQUITY_EXTENDED,
};

export function runTests() {
    const store = new QuoteStore();
    let entries = buildEntries([TICKER], store, DEFAULT_DISPLAY_SETTINGS);
    assertDeepEqual(view(entries), [{
        priceText: '...', percentText: '', arrow: '', priceColor: null,
        changeColor: null, isStale: true, priceFlash: false,
    }], 'Missing unattempted quotes should produce one loading entry');

    store.markStale([TICKER]);
    entries = buildEntries([TICKER], store, DEFAULT_DISPLAY_SETTINGS, entries);
    assertDeepEqual(view(entries), [{
        priceText: '--', percentText: '', arrow: '', priceColor: null,
        changeColor: null, isStale: true, priceFlash: false,
    }], 'A completed miss should move the same entry to its error state');

    store.recordPoll([TICKER], quoteMap(5100, '20260323', 5000));
    entries = buildEntries([TICKER], store, DEFAULT_DISPLAY_SETTINGS, entries);
    assertDeepEqual(view(entries), [{
        priceText: '5,100', percentText: '2.0%', arrow: '▲', priceColor: null,
        changeColor: POSITIVE_COLOR, isStale: false, priceFlash: false,
    }], 'A fresh quote should produce the complete formatted entry');

    store.mergeQuotes(quoteMap(5200, '20260323', null));
    const flashed = buildEntries([TICKER], store, DEFAULT_DISPLAY_SETTINGS, entries);
    assertDeepEqual(view(flashed), [{
        priceText: '5,200', percentText: '4.0%', arrow: '▲', priceColor: POSITIVE_COLOR,
        changeColor: POSITIVE_COLOR, isStale: false, priceFlash: true,
    }], 'A same-date missing close should preserve the baseline and decorate the price increase');

    entries = clearPriceFlash(flashed);
    assertDeepEqual(view(entries), [{
        priceText: '5,200', percentText: '4.0%', arrow: '▲', priceColor: null,
        changeColor: POSITIVE_COLOR, isStale: false, priceFlash: false,
    }], 'Clearing a flash should restore inherited neutral price text');

    store.mergeQuotes(quoteMap(5100, '20260324', null));
    store.markStale([TICKER]);
    entries = buildEntries([TICKER], store, DEFAULT_DISPLAY_SETTINGS, entries);
    assertDeepEqual(view(entries), [{
        priceText: '5,100', percentText: '', arrow: '', priceColor: null,
        changeColor: null, isStale: true, priceFlash: false,
    }], 'A new provider date should clear a missing close while stale values stay neutral');

    const shortEntries = [panelEntry('DXY', '98.21'), panelEntry('EUR/USD', '1.0912')];
    const crowdedEntries = [
        panelEntry('SPX', '6,870'), panelEntry('NDX', '26,123'), panelEntry('Gold', '4,120'),
        panelEntry('USO', '138.42'), panelEntry('ETH', '4,812'), panelEntry('BTC', '81,512'),
    ];
    const crowdedScale = getDensityFontScale(crowdedEntries, FONT_PRESETS.JETBRAINS_MONO);
    assertDeepEqual({
        short: getDensityFontScale(shortEntries, FONT_PRESETS.JETBRAINS_MONO),
        crowdedIsBounded: crowdedScale < 1 && crowdedScale >= 0.88,
        shared: getSharedDensityFontScale([shortEntries, crowdedEntries], FONT_PRESETS.JETBRAINS_MONO),
    }, {short: 1, crowdedIsBounded: true, shared: crowdedScale},
    'Density policy should remain full-size when short and bounded when crowded');
}

const quoteMap = (price, quoteDate, previousClose) =>
    new Map([[TICKER.symbol.toUpperCase(), {price, quoteDate, previousClose}]]);

function view(entries) {
    return entries.map(({priceText, percentText, arrow, priceColor, changeColor, isStale, priceFlash}) =>
        ({priceText, percentText, arrow, priceColor, changeColor, isStale, priceFlash}));
}

function panelEntry(label, priceText) {
    return {
        separatorBefore: ' · ',
        label,
        priceText,
        arrow: '▲',
        percentText: '1.0%',
        showPrice: true,
        showArrow: true,
        showPercent: true,
    };
}
