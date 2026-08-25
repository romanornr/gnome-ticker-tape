import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {QuotesService} from './services/quotes.js';
import {TickerIndicator} from './ui/indicator.js';
import {getSharedDensityFontScale} from './utils/display-density.js';
import {LEFT_PANEL_SIDE, RIGHT_PANEL_SIDE} from './utils/panel-sides.js';
import {
    loadDisplaySettings,
    SETTINGS_KEYS,
} from './utils/settings.js';

const LEFT_PANEL_POSITION = 999;
const DISPLAY_SETTING_KEYS = new Set([
    SETTINGS_KEYS.SHOW_PRICE,
    SETTINGS_KEYS.SHOW_ARROW,
    SETTINGS_KEYS.SHOW_PERCENT,
    SETTINGS_KEYS.SEPARATOR_STYLE,
    SETTINGS_KEYS.FONT_PRESET,
]);

/* Owns quote runtime state and projects entries into the two panel indicators. */
export default class TickerPriceExtension extends Extension {
    enable() {
        this._leftIndicator = null;
        this._rightIndicator = null;
        this._settings = this.getSettings();
        this._quotesService = new QuotesService(this.uuid, this._settings);
        this._quotesChangedId = this._quotesService.connect('entries-changed', () => {
            this._syncIndicators(this._quotesService.getEntries());
        });
        this._displaySettingsChangedId = this._settings.connect('changed', (_settings, key) => {
            if (DISPLAY_SETTING_KEYS.has(key))
                this._syncIndicators(this._quotesService.getEntries());
        });
        this._quotesService.start();
    }

    disable() {
        this._settings.disconnect(this._displaySettingsChangedId);
        this._quotesService.disconnect(this._quotesChangedId);
        this._quotesService.stop();
        this._quotesService = null;

        if (this._leftIndicator)
            this._leftIndicator.destroy();
        this._leftIndicator = null;

        if (this._rightIndicator)
            this._rightIndicator.destroy();
        this._rightIndicator = null;

        this._settings = null;
    }

    _syncIndicators(entries) {
        const displaySettings = loadDisplaySettings(this._settings);
        const leftEntries = entries.filter(entry => entry.panelSide === LEFT_PANEL_SIDE);
        const rightEntries = entries.filter(entry => entry.panelSide === RIGHT_PANEL_SIDE);
        const sharedDisplaySettings = {
            ...displaySettings,
            fontScaleOverride: getSharedDensityFontScale([leftEntries, rightEntries], displaySettings),
        };

        this._ensureIndicatorForSide(LEFT_PANEL_SIDE, leftEntries, sharedDisplaySettings);
        this._ensureIndicatorForSide(RIGHT_PANEL_SIDE, rightEntries, sharedDisplaySettings);
    }

    _ensureIndicatorForSide(side, sideEntries, displaySettings) {
        const propertyName = side === LEFT_PANEL_SIDE ? '_leftIndicator' : '_rightIndicator';
        const areaName = side === LEFT_PANEL_SIDE ? `${this.uuid}-left` : `${this.uuid}-right`;
        const position = side === LEFT_PANEL_SIDE ? LEFT_PANEL_POSITION : 0;

        if (sideEntries.length === 0) {
            if (this[propertyName])
                this[propertyName].destroy();
            this[propertyName] = null;
            return;
        }

        if (!this[propertyName]) {
            this[propertyName] = new TickerIndicator(() => this.openPreferences());
            Main.panel.addToStatusArea(areaName, this[propertyName], position, side);
        }

        this[propertyName].setEntries(sideEntries, displaySettings);
    }
}
