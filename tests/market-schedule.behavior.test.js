import {
    createMarketScheduleNow,
    getRefreshIntervalSecondsForTicker,
    getTickerSessionPhase,
    shouldRefreshTicker,
} from '../utils/market-schedule.js';
import {MARKET_SESSION_IDS} from '../utils/market-sessions.js';
import {assertDeepEqual} from './support/assert.js';

export function runTests() {
    const saturday = createMarketScheduleNow(new Date('2026-03-21T14:00:00Z'), 10_000_000);
    const mondayRegular = createMarketScheduleNow(new Date('2026-03-23T15:00:00Z'), 10_000_000);
    const weekdayOvernight = createMarketScheduleNow(new Date('2026-03-24T06:00:00Z'), 10_000_000);
    const mondayEuropeOpen = createMarketScheduleNow(new Date('2026-03-23T10:00:00Z'), 10_000_000);

    const cases = [
        [MARKET_SESSION_IDS.ALWAYS_OPEN, saturday, 0],
        [MARKET_SESSION_IDS.WEEKDAY_24H, saturday, 0],
        [MARKET_SESSION_IDS.WEEKDAY_24H, mondayRegular, 0],
        [MARKET_SESSION_IDS.US_EQUITY_EXTENDED, saturday, 0],
        [MARKET_SESSION_IDS.US_EQUITY_EXTENDED, mondayRegular, 0],
        [MARKET_SESSION_IDS.US_EQUITY_EXTENDED, weekdayOvernight, 0],
        [MARKET_SESSION_IDS.EUROPE_EQUITY_CASH, mondayEuropeOpen, 0],
        [MARKET_SESSION_IDS.US_EQUITY_EXTENDED, mondayRegular, 9_900_000],
    ];

    assertDeepEqual(cases.map(([marketSessionId, now, lastRefreshUsec]) => {
        const ticker = {marketSessionId};
        return {
            refresh: shouldRefreshTicker(ticker, now, lastRefreshUsec, 300),
            interval: getRefreshIntervalSecondsForTicker(ticker, now, 300),
            phase: getTickerSessionPhase(ticker, now),
        };
    }), [
        {refresh: true, interval: 300, phase: 'open'},
        {refresh: false, interval: 300, phase: 'closed'},
        {refresh: true, interval: 300, phase: 'open'},
        {refresh: false, interval: 300, phase: 'closed'},
        {refresh: true, interval: 300, phase: 'open'},
        {refresh: true, interval: 3600, phase: 'closed'},
        {refresh: true, interval: 300, phase: 'open'},
        {refresh: false, interval: 300, phase: 'open'},
    ], 'Market behavior classes should preserve weekend, session, and cadence policy');
}
