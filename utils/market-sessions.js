export const MARKET_SESSION_IDS = {
    ALWAYS_OPEN: 'always-open',
    WEEKDAY_24H: 'weekday-24h',
    US_EQUITY_EXTENDED: 'us-equity-extended',
    EUROPE_EQUITY_CASH: 'europe-equity-cash',
    UK_EQUITY_CASH: 'uk-equity-cash',
    JAPAN_EQUITY_CASH: 'japan-equity-cash',
    CHINA_EQUITY_CASH: 'china-equity-cash',
    HONG_KONG_EQUITY_CASH: 'hong-kong-equity-cash',
};

/* Trading windows are minutes after midnight in the market's local timezone. */
const MARKET_SESSION_PROFILES = {
    [MARKET_SESSION_IDS.ALWAYS_OPEN]: {alwaysOpen: true},
    [MARKET_SESSION_IDS.WEEKDAY_24H]: {
        timeZone: 'America/New_York',
        weekday24h: true,
    },
    [MARKET_SESSION_IDS.US_EQUITY_EXTENDED]: {
        timeZone: 'America/New_York',
        windows: [[4 * 60, 20 * 60]],
    },
    [MARKET_SESSION_IDS.EUROPE_EQUITY_CASH]: {
        timeZone: 'Europe/Berlin',
        windows: [[9 * 60, 17 * 60 + 30]],
    },
    [MARKET_SESSION_IDS.UK_EQUITY_CASH]: {
        timeZone: 'Europe/London',
        windows: [[8 * 60, 16 * 60 + 30]],
    },
    [MARKET_SESSION_IDS.JAPAN_EQUITY_CASH]: {
        timeZone: 'Asia/Tokyo',
        windows: [[9 * 60, 11 * 60 + 30], [12 * 60 + 30, 15 * 60 + 30]],
    },
    [MARKET_SESSION_IDS.CHINA_EQUITY_CASH]: {
        timeZone: 'Asia/Shanghai',
        windows: [[9 * 60 + 30, 11 * 60 + 30], [13 * 60, 15 * 60]],
    },
    [MARKET_SESSION_IDS.HONG_KONG_EQUITY_CASH]: {
        timeZone: 'Asia/Hong_Kong',
        windows: [[9 * 60 + 30, 12 * 60], [13 * 60, 16 * 60]],
    },
};

export function getMarketSessionProfile(sessionId) {
    return MARKET_SESSION_PROFILES[sessionId] ?? null;
}
