import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {QuotesService} from './services/quotes.js';
import {TickerIndicator} from './ui/indicator.js';
import {getSharedDensityFontScale} from './utils/display-density.js';
import {LEFT_PANEL_SIDE, RIGHT_PANEL_SIDE} from './utils/panel-sides.js';
import {
    getTickersForSide,
    loadDisplaySettings,
    loadTickerConfigs,
} from './utils/settings.js';

const LEFT_PANEL_POSITION = 999;

/*
 * This file is the GNOME Shell entrypoint for the extension as a whole.
 *
 * It does not fetch or format quotes itself. Its system role is to:
 * - own extension lifecycle hooks from GNOME Shell
 * - create and stop the QuotesService runtime
 * - mirror the current entry set into left and right panel indicators
 *
 * In other words, this is the bridge between GNOME Shell lifecycle/events and
 * the rest of the internal market-data system.
 */
/* TickerPriceExtension owns QuotesService snapshots and projects them into the two panel indicators. */
export default class TickerPriceExtension extends Extension {
    /* enable() creates the settings, quote service, and panel update subscription owned by this extension. */
    enable() {
        this._leftIndicator = null;
        this._rightIndicator = null;
        this._settings = this.getSettings();
        this._quotesService = new QuotesService(this.uuid, this._settings);
        this._quotesChangedId = this._quotesService.connect('entries-changed', () => {
            this._syncIndicators(this._quotesService.getEntries());
        });
        this._quotesService.start();
    }

    /* disable() releases the signal, runtime service, actors, and settings in ownership order. */
    disable() {
        this._quotesService.disconnect(this._quotesChangedId);
        this._quotesService.stop();
        this._quotesService = null;

        this._leftIndicator?.destroy();
        this._leftIndicator = null;

        this._rightIndicator?.destroy();
        this._rightIndicator = null;

        this._settings = null;
    }

    /* Entry changes from QuotesService are fanned back out to both panel-side indicators here. */
    _syncIndicators(entries) {
        const displaySettings = loadDisplaySettings(this._settings);
        const leftEntries = this._getEntriesForSide(entries, LEFT_PANEL_SIDE);
        const rightEntries = this._getEntriesForSide(entries, RIGHT_PANEL_SIDE);
        const sharedDisplaySettings = {
            ...displaySettings,
            fontScaleOverride: getSharedDensityFontScale([leftEntries, rightEntries], displaySettings.fontPreset),
        };

        this._ensureIndicatorForSide(LEFT_PANEL_SIDE, leftEntries, sharedDisplaySettings);
        this._ensureIndicatorForSide(RIGHT_PANEL_SIDE, rightEntries, sharedDisplaySettings);
    }

    /*
     * The extension keeps separate indicator instances per panel side so ticker
     * placement remains stable even as the saved list changes.
     */
    _ensureIndicatorForSide(side, sideEntries, displaySettings) {
        const propertyName = side === LEFT_PANEL_SIDE ? '_leftIndicator' : '_rightIndicator';
        const areaName = side === LEFT_PANEL_SIDE ? `${this.uuid}-left` : `${this.uuid}-right`;
        const position = side === LEFT_PANEL_SIDE ? LEFT_PANEL_POSITION : 0;

        if (sideEntries.length === 0) {
            this[propertyName]?.destroy();
            this[propertyName] = null;
            return;
        }

        if (!this[propertyName]) {
            this[propertyName] = new TickerIndicator(() => this.openPreferences());
            Main.panel.addToStatusArea(areaName, this[propertyName], position, side);
        }

        this[propertyName].setEntries(sideEntries, displaySettings);
    }

    /* Side filtering preserves saved ticker order per panel side before the indicator renders. */
    _getEntriesForSide(entries, side) {
        const tickersForSide = getTickersForSide(loadTickerConfigs(this._settings), side);
        const entriesBySymbol = new Map(entries.map(entry => [entry.symbol.toUpperCase(), entry]));
        const sideEntries = tickersForSide
            .map(ticker => entriesBySymbol.get(ticker.symbol.toUpperCase()))
            .filter(entry => entry !== undefined)
            .map(entry => ({...entry}));

        if (sideEntries.length > 0)
            sideEntries[0].separatorBefore = '';

        return sideEntries;
    }
}
