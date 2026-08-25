import {createMarketScheduleNow, shouldRefreshTicker} from '../utils/market-schedule.js';
import {MARKET_SESSION_IDS} from '../utils/market-sessions.js';
import {assertDeepEqual} from './support/assert.js';

export function runTests() {
    const at = (iso, monotonicUsec = 10_000_000) =>
        createMarketScheduleNow(new Date(iso), monotonicUsec);
    const cases = [
        [MARKET_SESSION_IDS.ALWAYS_OPEN, at('2026-03-21T14:00:00Z'), 9_900_000],
        [MARKET_SESSION_IDS.WEEKDAY_24H, at('2026-03-21T14:00:00Z'), 0],
        [MARKET_SESSION_IDS.WEEKDAY_24H, at('2026-03-23T15:00:00Z'), 0],
        [MARKET_SESSION_IDS.US_EQUITY_EXTENDED, at('2026-03-21T14:00:00Z'), 0],
        [MARKET_SESSION_IDS.US_EQUITY_EXTENDED, at('2026-03-23T15:00:00Z'), 9_900_000],
        [MARKET_SESSION_IDS.US_EQUITY_EXTENDED, at('2026-03-24T06:00:00Z'), 0],
        [MARKET_SESSION_IDS.US_EQUITY_EXTENDED, at('2026-03-24T06:00:00Z', 3_500_000_000), 1],
        [MARKET_SESSION_IDS.US_EQUITY_EXTENDED, at('2026-03-24T06:00:00Z', 3_700_000_000), 1],
        [MARKET_SESSION_IDS.EUROPE_EQUITY_CASH, at('2026-03-23T10:00:00Z'), 0],
    ];

    assertDeepEqual(cases.map(([marketSessionId, now, lastRefreshUsec]) =>
        shouldRefreshTicker({marketSessionId}, now, lastRefreshUsec, 300)),
    [true, false, true, false, false, true, false, true, true],
    'Session policy should preserve always-open, weekend, open-window, and closed-market cadence');
}
