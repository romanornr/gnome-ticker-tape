import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {clearPriceFlash} from './entry-model.js';
const CRYPTO_UI_UPDATE_INTERVAL_SECONDS = 4;
const PRICE_FLASH_DURATION_MS = 700;

/*
 * QuoteUpdateScheduler owns polling, live-update throttling, and display timers.
 * It also turns restored network availability into one recovery attempt.
 */
export class QuoteUpdateScheduler {
    constructor({
        onRefresh,
        onReconnectLiveProviders = () => {},
        onRebuildEntries = () => {},
        onResetPriceFlash = () => {},
        networkMonitor = Gio.NetworkMonitor.get_default(),
    }) {
        this._onRefresh = onRefresh;
        this._onReconnectLiveProviders = onReconnectLiveProviders;
        this._onRebuildEntries = onRebuildEntries;
        this._onResetPriceFlash = onResetPriceFlash;
        this._networkMonitor = networkMonitor;
        this._networkMonitorSignalId = 0;
        this._lifecycleGeneration = 0;
        this._networkAvailable = false;
        this._refreshTimeoutId = 0;
        this._refreshInProgress = false;
        this._forcedRefreshQueued = false;
        this._entriesUpdateTimeoutId = 0;
        this._lastEntriesUpdateUsec = 0;
        this._priceFlashTimeoutId = 0;
    }

    /* Each lifecycle clears all of its timers and network state here. */
    stop() {
        this._lifecycleGeneration += 1;
        this._refreshTimeoutId = removeTimeout(this._refreshTimeoutId);
        this._entriesUpdateTimeoutId = removeTimeout(this._entriesUpdateTimeoutId);
        this._priceFlashTimeoutId = removeTimeout(this._priceFlashTimeoutId);
        if (this._networkMonitorSignalId !== 0)
            this._networkMonitor.disconnect(this._networkMonitorSignalId);
        this._networkMonitorSignalId = 0;
        this._refreshInProgress = false;
        this._forcedRefreshQueued = false;
        this._lastEntriesUpdateUsec = 0;
    }

    /* Scheduling the polling timer activates refresh and network recovery. */
    scheduleRefreshTimer(refreshIntervalSeconds) {
        if (this._networkMonitorSignalId === 0) {
            this._networkAvailable = this._networkMonitor.get_network_available();
            this._networkMonitorSignalId = this._networkMonitor.connect(
                'network-changed',
                (_monitor, available) => this._handleNetworkChanged(available)
            );
        }
        this._refreshTimeoutId = removeTimeout(this._refreshTimeoutId);
        this._refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            refreshIntervalSeconds,
            () => {
                this.requestRefresh(false);
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    /* Provider passes are single-flight; only forced work survives an overlap. */
    requestRefresh(forced = false) {
        if (this._networkMonitorSignalId === 0)
            return;

        if (this._refreshInProgress) {
            this._forcedRefreshQueued ||= forced;
            return;
        }

        void this._runRefresh(forced);
    }

    /* Live updates may arrive faster than the panel should redraw, so rebuild requests are coalesced here. */
    requestEntriesUpdate(immediate = false) {
        if (this._networkMonitorSignalId === 0)
            return;

        if (immediate) {
            this._runEntriesUpdate();
            return;
        }

        const elapsedSeconds = (GLib.get_monotonic_time() - this._lastEntriesUpdateUsec) / 1_000_000;
        if (this._lastEntriesUpdateUsec === 0 || elapsedSeconds >= CRYPTO_UI_UPDATE_INTERVAL_SECONDS) {
            this._runEntriesUpdate();
            return;
        }

        if (this._entriesUpdateTimeoutId !== 0)
            return;

        const remainingMs = Math.max(1, Math.round((CRYPTO_UI_UPDATE_INTERVAL_SECONDS - elapsedSeconds) * 1000));

        this._entriesUpdateTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            remainingMs,
            () => {
                this._entriesUpdateTimeoutId = 0;
                this._runEntriesUpdate();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    schedulePriceFlashReset(entries) {
        this._priceFlashTimeoutId = removeTimeout(this._priceFlashTimeoutId);

        if (!entries.some(entry => entry.priceFlash))
            return;

        this._priceFlashTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            PRICE_FLASH_DURATION_MS,
            () => {
                this._priceFlashTimeoutId = 0;
                this._onResetPriceFlash(clearPriceFlash(entries));
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    /* Every rebuild clears an older source before resetting the synchronous throttle window. */
    _runEntriesUpdate() {
        this._entriesUpdateTimeoutId = removeTimeout(this._entriesUpdateTimeoutId);
        this._lastEntriesUpdateUsec = GLib.get_monotonic_time();
        this._onRebuildEntries();
    }

    /* The generation prevents late completions from mutating a replacement lifecycle. */
    async _runRefresh(forced) {
        const lifecycleGeneration = this._lifecycleGeneration;
        this._refreshInProgress = true;

        try {
            await this._onRefresh(forced);
        } finally {
            if (this._lifecycleGeneration === lifecycleGeneration) {
                this._refreshInProgress = false;
                if (this._forcedRefreshQueued) {
                    this._forcedRefreshQueued = false;
                    this.requestRefresh(true);
                }
            }
        }
    }

    /*
     * Only a false-to-true edge is recovery: available events also report route
     * and VPN changes, where reconnecting would tear down healthy sockets.
     */
    _handleNetworkChanged(available) {
        const restored = available && !this._networkAvailable;
        this._networkAvailable = available;
        if (!restored)
            return;

        this._onReconnectLiveProviders();
        this.requestRefresh(true);
    }
}

function removeTimeout(sourceId) {
    if (sourceId === 0)
        return 0;

    GLib.Source.remove(sourceId);
    return 0;
}
