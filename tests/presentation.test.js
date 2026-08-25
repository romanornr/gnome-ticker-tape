import {buildEntries} from '../services/entry-model.js';
import {QuoteStore} from '../services/quote-store.js';
import {createDisplayEntry, NEGATIVE_COLOR} from '../utils/format.js';
import {assertDeepEqual} from './support/assert.js';

const TICKERS = [
    ticker('Left AAPL', 'left'),
    ticker('Right AAPL', 'right'),
];

export function runTests() {
    const store = new QuoteStore();
    store.recordPoll(TICKERS, new Map([['AAPL.US', {
        price: 95,
        quoteDate: '20260825',
        previousClose: 100,
    }]]));

    assertDeepEqual(buildEntries(TICKERS, store).map(entry => ({
        label: entry.label,
        panelSide: entry.panelSide,
        percentText: entry.percentText,
        arrow: entry.arrow,
        changeColor: entry.changeColor,
    })), [
        {label: 'Left AAPL', panelSide: 'left', percentText: '-5.0%', arrow: '▼', changeColor: NEGATIVE_COLOR},
        {label: 'Right AAPL', panelSide: 'right', percentText: '-5.0%', arrow: '▼', changeColor: NEGATIVE_COLOR},
    ], 'Duplicate symbols should preserve panel identity and show a signed negative percentage');

    assertDeepEqual([0, -10].map(previousClose => {
        const entry = createDisplayEntry(TICKERS[0], {price: 95, previousClose});
        return [entry.priceText, entry.percentText, entry.arrow, entry.changeColor];
    }), [
        ['95.00', '', '', null],
        ['95.00', '', '', null],
    ], 'Nonpositive previous closes should suppress change presentation');
}

function ticker(label, panelSide) {
    return {label, symbol: 'aapl.us', priceDecimals: 2, panelSide};
}
