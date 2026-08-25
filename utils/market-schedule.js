import GLib from 'gi://GLib';

import {DEFAULT_REFRESH_INTERVAL_SECONDS} from './display-settings.js';
import {getMarketSessionProfile} from './market-sessions.js';

const CLOSED_MARKET_REFRESH_SECONDS = 3600;

export function createMarketScheduleNow(date = new Date(), monotonicUsec = GLib.get_monotonic_time()) {
    return {date, monotonicUsec};
}

/* Open markets use the base cadence; closed cash markets are checked hourly. */
export function shouldRefreshTicker(
    ticker,
    now = createMarketScheduleNow(),
    lastRefreshUsec = 0,
    baseIntervalSeconds = DEFAULT_REFRESH_INTERVAL_SECONDS
) {
    const profile = getMarketSessionProfile(ticker.marketSessionId);
    if (profile.alwaysOpen)
        return true;

    if (isWeekend(profile, now.date))
        return false;

    if (profile.weekday24h)
        return true;

    const interval = isWithinTradingWindow(profile, now.date)
        ? baseIntervalSeconds
        : Math.max(baseIntervalSeconds, CLOSED_MARKET_REFRESH_SECONDS);
    return lastRefreshUsec === 0 ||
        (now.monotonicUsec - lastRefreshUsec) / 1_000_000 >= interval;
}

function isWeekend(profile, date) {
    const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: profile.timeZone,
        weekday: 'short',
    }).format(date);
    return weekday === 'Sat' || weekday === 'Sun';
}

function isWithinTradingWindow(profile, date) {
    const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: profile.timeZone,
        hour: 'numeric',
        hourCycle: 'h23',
        minute: 'numeric',
    }).formatToParts(date).map(part => [part.type, part.value]));
    const localMinutes = Number(values.hour) * 60 + Number(values.minute);
    return profile.windows.some(([start, end]) => localMinutes >= start && localMinutes < end);
}
