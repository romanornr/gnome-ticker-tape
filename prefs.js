import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {getAssetCategoryOptions} from './utils/asset-categories.js';
import {LEFT_PANEL_SIDE, RIGHT_PANEL_SIDE} from './utils/panel-sides.js';
import {
    loadDisplaySettings,
    loadRefreshIntervalSeconds,
    loadTickerConfigs,
    resetTickerConfigs,
    saveTickerConfigs,
    SETTINGS_KEYS,
} from './utils/settings.js';
import {
    formatRefreshIntervalLabel,
    getFontPresetOptions,
    getRefreshIntervalOptions,
    getSeparatorOptions,
} from './utils/display-settings.js';
import {presentTickerDialog} from './utils/prefs/ticker-dialog-controller.js';

/* The preferences page owns saved-ticker actions and delegates catalog selection to its dialog. */
class TickerPreferencesPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(settings, window) {
        super({title: 'Preferences', icon_name: 'view-list-symbolic'});

        this._settings = settings;
        this._window = window;
        this._leftTickerGroup = null;
        this._rightTickerGroup = null;
        this._tickerActionsGroup = null;
        this._tickerRows = [];
        this._refreshOptions = getRefreshIntervalOptions();
        this._assetCategoryOptions = getAssetCategoryOptions();

        this._build();
        this._rebuildTickerRows();
    }

    _build() {
        this._leftTickerGroup = new Adw.PreferencesGroup({title: 'Left Panel Tickers', description: 'Tickers configured to appear on the left side of the panel.'});
        this.add(this._leftTickerGroup);

        this._rightTickerGroup = new Adw.PreferencesGroup({title: 'Right Panel Tickers', description: 'Tickers configured to appear on the right side of the panel.'});
        this.add(this._rightTickerGroup);

        this._tickerActionsGroup = new Adw.PreferencesGroup({title: 'Ticker Management', description: 'Restore the built-in ticker list and placement.'});
        this.add(this._tickerActionsGroup);

        const refreshGroup = new Adw.PreferencesGroup({title: 'Refresh'});
        this.add(refreshGroup);

        const refreshRow = this._createComboRow({
            title: 'Base polling interval',
            subtitle: 'Used as the normal polling cadence. Existing weekend and overnight rules still apply.',
            options: this._refreshOptions.map(seconds => ({
                value: seconds,
                title: formatRefreshIntervalLabel(seconds),
            })),
            selectedValue: loadRefreshIntervalSeconds(this._settings),
            onSelected: value => this._settings.set_uint(SETTINGS_KEYS.REFRESH_INTERVAL_SECONDS, value),
        });
        refreshGroup.add(refreshRow);

        const displayGroup = new Adw.PreferencesGroup({title: 'Display'});
        this.add(displayGroup);

        const displaySettings = loadDisplaySettings(this._settings);

        displayGroup.add(this._createSwitchRow({
            title: 'Show price',
            key: SETTINGS_KEYS.SHOW_PRICE,
        }));
        displayGroup.add(this._createSwitchRow({
            title: 'Show arrow',
            key: SETTINGS_KEYS.SHOW_ARROW,
        }));
        displayGroup.add(this._createSwitchRow({
            title: 'Show percent',
            key: SETTINGS_KEYS.SHOW_PERCENT,
        }));

        displayGroup.add(this._createComboRow({
            title: 'Separator',
            options: getSeparatorOptions(),
            selectedValue: displaySettings.separatorStyle,
            onSelected: value => this._settings.set_string(SETTINGS_KEYS.SEPARATOR_STYLE, value),
        }));

        displayGroup.add(this._createComboRow({
            title: 'Panel font',
            subtitle: 'Preset fonts fall back through the system if they are not installed.',
            options: getFontPresetOptions(),
            selectedValue: displaySettings.fontPreset,
            onSelected: value => this._settings.set_string(SETTINGS_KEYS.FONT_PRESET, value),
        }));
    }

    _rebuildTickerRows() {
        this._clearTickerRows();

        const tickers = loadTickerConfigs(this._settings);
        const leftTickers = tickers.filter(ticker => ticker.panelSide === LEFT_PANEL_SIDE);
        const rightTickers = tickers.filter(ticker => ticker.panelSide === RIGHT_PANEL_SIDE);

        this._addTickerRowsForSide({tickers, visibleTickers: leftTickers, group: this._leftTickerGroup, addSide: LEFT_PANEL_SIDE});
        this._addTickerRowsForSide({tickers, visibleTickers: rightTickers, group: this._rightTickerGroup, addSide: RIGHT_PANEL_SIDE});

        const resetRow = new Adw.ActionRow({title: 'Reset to defaults', subtitle: 'Restore the built-in ticker list and placement.'});
        resetRow.add_suffix(this._createTextButton('Reset', () => {
            resetTickerConfigs(this._settings);
            this._rebuildTickerRows();
        }));
        this._addTickerRow(this._tickerActionsGroup, resetRow);
    }

    _addTickerRowsForSide({tickers, visibleTickers, group, addSide}) {
        visibleTickers.forEach((ticker, visibleIndex) => {
            const index = tickers.indexOf(ticker);
            const row = new Adw.ActionRow({title: ticker.label, subtitle: `${ticker.liveSymbol ?? ticker.symbol} \u00b7 ${ticker.priceDecimals} decimals`});

            row.add_suffix(this._createIconButton('go-up-symbolic', 'Move up', () => {
                if (visibleIndex === 0)
                    return;

                const previousTicker = visibleTickers[visibleIndex - 1];
                const previousIndex = tickers.indexOf(previousTicker);
                const nextTickers = [...tickers];
                [nextTickers[previousIndex], nextTickers[index]] = [nextTickers[index], nextTickers[previousIndex]];
                saveTickerConfigs(this._settings, nextTickers);
                this._rebuildTickerRows();
            }, visibleIndex === 0));

            row.add_suffix(this._createIconButton('go-down-symbolic', 'Move down', () => {
                if (visibleIndex === visibleTickers.length - 1)
                    return;

                const nextTicker = visibleTickers[visibleIndex + 1];
                const nextIndex = tickers.indexOf(nextTicker);
                const nextTickers = [...tickers];
                [nextTickers[index], nextTickers[nextIndex]] = [nextTickers[nextIndex], nextTickers[index]];
                saveTickerConfigs(this._settings, nextTickers);
                this._rebuildTickerRows();
            }, visibleIndex === visibleTickers.length - 1));

            row.add_suffix(this._createTextButton('Edit', () => {
                presentTickerDialog({
                    window: this._window,
                    title: 'Edit ticker',
                    initialTicker: ticker,
                    onSave: updatedTicker => {
                        const nextTickers = [...tickers];
                        nextTickers[index] = updatedTicker;
                        saveTickerConfigs(this._settings, nextTickers);
                        this._rebuildTickerRows();
                    },
                });
            }));

            row.add_suffix(this._createTextButton('Remove', () => {
                const nextTickers = tickers.filter((_, tickerIndex) => tickerIndex !== index);
                saveTickerConfigs(this._settings, nextTickers);
                this._rebuildTickerRows();
            }));

            this._addTickerRow(group, row);
        });

        const addRow = new Adw.ActionRow({title: 'Add ticker'});
        addRow.add_suffix(this._createTextButton('+ Add ticker', () => {
            this._presentAssetCategoryDialog({
                title: 'Add ticker',
                initialAssetCategory: this._assetCategoryOptions[0].value,
                onSelected: assetCategory => {
                    presentTickerDialog({
                        window: this._window,
                        title: 'Add ticker',
                        initialTicker: {
                            label: '',
                            symbol: '',
                            priceDecimals: 2,
                            panelSide: addSide,
                            assetCategory,
                        },
                        onSave: newTicker => {
                            saveTickerConfigs(this._settings, [...tickers, newTicker]);
                            this._rebuildTickerRows();
                        },
                    });
                },
            });
        }));
        this._addTickerRow(group, addRow);
    }

    _presentAssetCategoryDialog({title, initialAssetCategory, onSelected}) {
        const dialog = new Adw.AlertDialog({
            heading: title,
            body: 'Choose what kind of ticker you want to add.',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('continue', 'Continue');
        dialog.set_close_response('cancel');
        dialog.set_default_response('continue');
        dialog.set_response_appearance('continue', Adw.ResponseAppearance.SUGGESTED);

        const group = new Adw.PreferencesGroup();
        dialog.set_extra_child(group);

        const categoryRow = this._createComboRow({
            title: 'Asset type',
            options: this._assetCategoryOptions,
            selectedValue: initialAssetCategory,
        });
        group.add(categoryRow);

        /* AlertDialog closes itself before emitting response, so the editor can be presented from this handler. */
        dialog.connect('response', (_dialog, responseId) => {
            if (responseId !== 'continue')
                return;

            onSelected(this._assetCategoryOptions[categoryRow.selected].value);
        });

        dialog.present(this._window);
    }

    _clearTickerRows() {
        this._tickerRows.forEach(({group, row}) => group.remove(row));
        this._tickerRows = [];
    }

    _addTickerRow(group, row) {
        group.add(row);
        this._tickerRows.push({group, row});
    }

    _createSwitchRow({title, key}) {
        const row = new Adw.SwitchRow({title, active: this._settings.get_boolean(key)});
        row.connect('notify::active', widget => {
            this._settings.set_boolean(key, widget.active);
        });
        return row;
    }

    _createComboRow({title, subtitle = '', options, selectedValue, onSelected = null}) {
        const stringList = Gtk.StringList.new(options.map(option => option.title));
        const row = new Adw.ComboRow({title, subtitle, model: stringList});

        const selectedIndex = Math.max(0, options.findIndex(option => option.value === selectedValue));
        row.selected = selectedIndex;
        if (onSelected)
            row.connect('notify::selected', widget => onSelected(options[widget.selected].value));

        return row;
    }

    _createIconButton(iconName, tooltipText, onClicked, disabled = false) {
        const button = new Gtk.Button({
            child: new Gtk.Image({icon_name: iconName}),
            tooltip_text: tooltipText,
            sensitive: !disabled,
            valign: Gtk.Align.CENTER,
        });
        button.connect('clicked', onClicked);
        return button;
    }

    _createTextButton(label, onClicked) {
        const button = new Gtk.Button({label, valign: Gtk.Align.CENTER});
        button.connect('clicked', onClicked);
        return button;
    }
}

export default class TickerPriceExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(760, 720);
        window.add(new TickerPreferencesPage(this.getSettings(), window));
    }
}
