import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {clearPriceFlash} from './entry-model.js';

const CRYPTO_UI_UPDATE_INTERVAL_SECONDS = 4;
const PRICE_FLASH_DURATION_MS = 700;

/* Owns polling, live-update throttling, price flash timing, and network recovery. */
export class QuoteUpdateScheduler {
    constructor({
        onRefresh,
        onReconnectLiveProviders,
        onRebuildEntries,
        onResetPriceFlash,
        networkMonitor = Gio.NetworkMonitor.get_default(),
    }) {
        this._onRefresh = onRefresh;
        this._onReconnectLiveProviders = onReconnectLiveProviders;
        this._onRebuildEntries = onRebuildEntries;
        this._onResetPriceFlash = onResetPriceFlash;
        this._networkMonitor = networkMonitor;
        this._networkMonitorSignalId = 0;
        this._networkAvailable = false;
        this._refreshTimeoutId = 0;
        this._refreshInProgress = false;
        this._forcedRefreshQueued = false;
        this._entriesUpdateTimeoutId = 0;
        this._lastEntriesUpdateUsec = 0;
        this._priceFlashTimeoutId = 0;
    }

    stop() {
        this._refreshTimeoutId = removeTimeout(this._refreshTimeoutId);
        this._entriesUpdateTimeoutId = removeTimeout(this._entriesUpdateTimeoutId);
        this._priceFlashTimeoutId = removeTimeout(this._priceFlashTimeoutId);
        this._networkMonitor.disconnect(this._networkMonitorSignalId);
        this._forcedRefreshQueued = false;
    }

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
                this.requestRefresh();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    /* Refreshes are single-flight; only an overlapping forced refresh survives. */
    requestRefresh(forced = false) {
        if (this._refreshInProgress) {
            this._forcedRefreshQueued ||= forced;
            return;
        }

        void this._runRefresh(forced);
    }

    requestEntriesUpdate(immediate = false) {
        if (immediate) {
            this._runEntriesUpdate();
            return;
        }

        const elapsed = (GLib.get_monotonic_time() - this._lastEntriesUpdateUsec) / 1_000_000;
        if (this._lastEntriesUpdateUsec === 0 || elapsed >= CRYPTO_UI_UPDATE_INTERVAL_SECONDS) {
            this._runEntriesUpdate();
            return;
        }

        if (this._entriesUpdateTimeoutId !== 0)
            return;

        const remainingMs = Math.max(1, Math.round((CRYPTO_UI_UPDATE_INTERVAL_SECONDS - elapsed) * 1000));
        this._entriesUpdateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, remainingMs, () => {
            this._entriesUpdateTimeoutId = 0;
            this._runEntriesUpdate();
            return GLib.SOURCE_REMOVE;
        });
    }

    schedulePriceFlashReset(entries) {
        this._priceFlashTimeoutId = removeTimeout(this._priceFlashTimeoutId);
        if (!entries.some(entry => entry.priceFlash))
            return;

        this._priceFlashTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PRICE_FLASH_DURATION_MS, () => {
            this._priceFlashTimeoutId = 0;
            this._onResetPriceFlash(clearPriceFlash(entries));
            return GLib.SOURCE_REMOVE;
        });
    }

    _runEntriesUpdate() {
        this._entriesUpdateTimeoutId = removeTimeout(this._entriesUpdateTimeoutId);
        this._lastEntriesUpdateUsec = GLib.get_monotonic_time();
        this._onRebuildEntries();
    }

    async _runRefresh(forced) {
        this._refreshInProgress = true;
        try {
            await this._onRefresh(forced);
        } finally {
            this._refreshInProgress = false;
            if (this._forcedRefreshQueued) {
                this._forcedRefreshQueued = false;
                this.requestRefresh(true);
            }
        }
    }

    /* Only a false-to-true edge represents restored connectivity. */
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
    if (sourceId !== 0)
        GLib.Source.remove(sourceId);
    return 0;
}
