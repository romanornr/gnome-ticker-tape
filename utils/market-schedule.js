import GLib from 'gi://GLib';

import {getTickerMarketSessionPolicy} from './asset-categories.js';
import {DEFAULT_REFRESH_INTERVAL_SECONDS} from './display-settings.js';
import {
    MARKET_SESSION_IDS,
    getMarketSessionProfile,
} from './market-sessions.js';

/*
 * Market schedule rules answer one narrow system question:
 * when should a ticker be refreshed, given its market session model?
 *
 * Keeping these rules here prevents time-zone/session policy from being spread
 * across QuotesService, providers, and prefs code.
 */

/*
 * A closed market cannot move its price, so polling only picks up a revised
 * closing print and any ticker added while the market was shut. Hourly covers
 * both; the session profiles no longer each restate this.
 */
const CLOSED_MARKET_REFRESH_SECONDS = 3600;

/* The scheduler snapshots both wall-clock date and monotonic time here so policy and cadence share one input shape. */
export function createMarketScheduleNow(date = new Date(), monotonicUsec = GLib.get_monotonic_time()) {
    return {date, monotonicUsec};
}

/* The scheduling layer asks this one question for every ticker on each refresh pass. */
export function shouldRefreshTicker(
    ticker,
    now = createMarketScheduleNow(),
    lastRefreshUsec = 0,
    baseIntervalSeconds = DEFAULT_REFRESH_INTERVAL_SECONDS
) {
    const profile = getTickerMarketSessionProfile(ticker);
    if (!profile || profile.id === MARKET_SESSION_IDS.ALWAYS_OPEN)
        return true;

    if (isProfileWeekend(profile, now.date))
        return false;

    if (profile.kind === 'weekday-24h')
        return true;

    return hasReachedCadence(
        lastRefreshUsec,
        getRefreshIntervalSecondsForTicker(ticker, now, baseIntervalSeconds),
        now.monotonicUsec
    );
}

/* U.S.-session tickers reuse this helper so the overnight slowdown policy stays centralized. */
export function getRefreshIntervalSecondsForTicker(
    ticker,
    now = createMarketScheduleNow(),
    baseIntervalSeconds = DEFAULT_REFRESH_INTERVAL_SECONDS
) {
    const intervalSeconds = baseIntervalSeconds || DEFAULT_REFRESH_INTERVAL_SECONDS;
    const profile = getTickerMarketSessionProfile(ticker);
    if (!profile || profile.id === MARKET_SESSION_IDS.ALWAYS_OPEN || profile.kind === 'weekday-24h')
        return intervalSeconds;

    return getProfileSessionPhase(profile, now.date) === 'closed'
        ? Math.max(intervalSeconds, CLOSED_MARKET_REFRESH_SECONDS)
        : intervalSeconds;
}

/* UI layers use this to distinguish expected closed-market cache reuse from data failures. */
export function getTickerSessionPhase(ticker, now = createMarketScheduleNow()) {
    const profile = getTickerMarketSessionProfile(ticker);
    if (!profile)
        return 'open';

    if (profile.id === MARKET_SESSION_IDS.ALWAYS_OPEN)
        return 'open';

    if (isProfileWeekend(profile, now.date))
        return 'closed';

    if (profile.kind === 'weekday-24h')
        return 'open';

    return getProfileSessionPhase(profile, now.date);
}

/* Refresh cadence is evaluated against monotonic time so local clock changes do not distort polling behavior. */
function hasReachedCadence(lastRefreshUsec, refreshIntervalSeconds, nowUsec) {
    if (!lastRefreshUsec) return true;

    const elapsedSeconds = (nowUsec - lastRefreshUsec) / 1_000_000;
    return elapsedSeconds >= refreshIntervalSeconds;
}

/* Effective ticker policy becomes the canonical profile used by cadence and phase checks here. */
function getTickerMarketSessionProfile(ticker) {
    return getMarketSessionProfile(getTickerMarketSessionPolicy(ticker).marketSessionId);
}

/* Weekend rules are evaluated in the profile timezone rather than the user's local timezone. */
function isProfileWeekend(profile, date) {
    const weekday = new Intl.DateTimeFormat('en-US', {timeZone: profile.timeZone, weekday: 'short'}).format(date);

    return profile.weekendDays.includes(weekday);
}

/* Session-window profiles evaluate the active phase from the configured market-local clock. */
function getProfileSessionPhase(profile, date) {
    if (profile.kind !== 'session-window')
        return 'closed';

    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: profile.timeZone,
        hour: 'numeric',
        hourCycle: 'h23',
        minute: 'numeric',
    }).formatToParts(date);

    const hour = Number.parseInt(parts.find(part => part.type === 'hour')?.value ?? '', 10);
    const minute = Number.parseInt(parts.find(part => part.type === 'minute')?.value ?? '', 10);

    if (!Number.isInteger(hour) || !Number.isInteger(minute))
        return 'open';

    const minutesSinceMidnight = (hour * 60) + minute;
    const matchingPhase = profile.phases.find(phase =>
        minutesSinceMidnight >= phase.startMinutes && minutesSinceMidnight < phase.endMinutes
    );

    return matchingPhase?.name ?? 'closed';
}
