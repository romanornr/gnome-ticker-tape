import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import {
    ASSET_CATEGORIES,
    CRYPTO_PROVIDERS,
    getCryptoProviderOptions,
    getDefaultCryptoProvider,
} from '../asset-categories.js';
import {loadHyperliquidMarkets} from '../../providers/hyperliquid/catalog.js';
import {loadKrakenSpotPairs} from '../../providers/kraken/catalog.js';
import {LEFT_PANEL_SIDE, RIGHT_PANEL_SIDE} from '../panel-sides.js';
import {matchCuratedTickers} from '../ticker-catalog.js';

const MAX_SUGGESTIONS = 8;

/* The ticker dialog selects one catalog entry and adds only display preferences to it. */
class TickerDialogController {
    constructor({window, title, initialTicker, onSave}) {
        this.window = window;
        this.title = title;
        this.initialTicker = initialTicker;
        this.onSave = onSave;
        this.assetCategory = initialTicker.assetCategory;
        this.cryptoProvider = initialTicker.cryptoProvider ?? getDefaultCryptoProvider();
        this.selectedTicker = initialTicker.label && initialTicker.symbol ? initialTicker : null;
        this.cryptoCatalog = null;
        this.cryptoCatalogError = '';
        this.suggestionRows = [];

        this._buildUi();
        this._connectSignals();
    }

    present() {
        this._syncSelection();
        this._renderSuggestions();
        if (this.assetCategory === ASSET_CATEGORIES.CRYPTO)
            void this._loadCryptoCatalog();
        this.dialog.present(this.window);
    }

    _buildUi() {
        this.dialog = new Adw.Dialog({title: this.title});
        this.dialog.set_content_width(680);
        this.dialog.set_content_height(620);

        const toolbarView = new Adw.ToolbarView();
        const headerBar = new Adw.HeaderBar({
            show_end_title_buttons: false,
            show_start_title_buttons: false,
        });
        toolbarView.add_top_bar(headerBar);

        this.cancelButton = new Gtk.Button({label: 'Cancel'});
        headerBar.pack_start(this.cancelButton);

        this.saveButton = new Gtk.Button({label: 'Save'});
        this.saveButton.add_css_class('suggested-action');
        headerBar.pack_end(this.saveButton);

        const content = new Gtk.Box({
            margin_bottom: 18,
            margin_end: 18,
            margin_start: 18,
            margin_top: 18,
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
        });
        const scrolledWindow = new Gtk.ScrolledWindow({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
        });
        scrolledWindow.set_child(content);
        toolbarView.set_content(scrolledWindow);
        this.dialog.set_child(toolbarView);

        const formGroup = new Adw.PreferencesGroup();
        content.append(formGroup);

        if (this.assetCategory === ASSET_CATEGORIES.CRYPTO) {
            this.cryptoProviderOptions = getCryptoProviderOptions();
            this.cryptoProviderRow = createComboRow({
                title: 'Crypto provider',
                options: this.cryptoProviderOptions,
                selectedValue: this.cryptoProvider,
            });
            formGroup.add(this.cryptoProviderRow);
        }

        this.searchRow = new Adw.EntryRow({title: 'Search catalog'});
        formGroup.add(this.searchRow);

        this.selectedRow = new Adw.ActionRow();
        formGroup.add(this.selectedRow);

        const decimalsAdjustment = new Gtk.Adjustment({
            lower: 0,
            upper: 6,
            step_increment: 1,
            page_increment: 1,
            value: this.initialTicker.priceDecimals ?? 2,
        });
        this.decimalsRow = new Adw.SpinRow({title: 'Decimals', adjustment: decimalsAdjustment});
        formGroup.add(this.decimalsRow);

        this.sideOptions = [
            {value: LEFT_PANEL_SIDE, title: 'Left'},
            {value: RIGHT_PANEL_SIDE, title: 'Right'},
        ];
        this.sideRow = createComboRow({
            title: 'Panel side',
            options: this.sideOptions,
            selectedValue: this.initialTicker.panelSide ?? RIGHT_PANEL_SIDE,
        });
        formGroup.add(this.sideRow);

        this.suggestionsGroup = new Adw.PreferencesGroup({title: 'Catalog matches'});
        content.append(this.suggestionsGroup);
        this._syncSuggestionsDescription();
    }

    _connectSignals() {
        if (this.cryptoProviderRow) {
            this.cryptoProviderRow.connect('notify::selected', widget => {
                const provider = this.cryptoProviderOptions[widget.selected].value;
                if (provider === this.cryptoProvider)
                    return;

                this.cryptoProvider = provider;
                this.selectedTicker = null;
                this.cryptoCatalog = null;
                this.cryptoCatalogError = '';
                this.searchRow.text = '';
                this._syncSelection();
                this._syncSuggestionsDescription();
                this._renderSuggestions();
                void this._loadCryptoCatalog();
            });
        }

        this.searchRow.connect('notify::text', () => this._renderSuggestions());
        this.cancelButton.connect('clicked', () => this.dialog.close());
        this.saveButton.connect('clicked', () => {
            this.onSave(this._buildTicker());
            this.dialog.close();
        });
        this.dialog.connect('closed', () => {
            this.dialog = null;
        });
    }

    _selectTicker(ticker) {
        this.selectedTicker = ticker;
        this.decimalsRow.value = ticker.priceDecimals;
        this._syncSelection();
    }

    _syncSelection() {
        if (this.selectedTicker) {
            this.selectedRow.title = this.selectedTicker.label;
            this.selectedRow.subtitle = this.selectedTicker.liveSymbol ?? this.selectedTicker.symbol;
        } else {
            this.selectedRow.title = 'No ticker selected';
            this.selectedRow.subtitle = 'Choose a catalog match below.';
        }

        this.saveButton.set_sensitive(this.selectedTicker !== null);
    }

    _syncSuggestionsDescription() {
        if (this.assetCategory !== ASSET_CATEGORIES.CRYPTO)
            this.suggestionsGroup.description = 'Search the built-in catalog, then choose a ticker.';
        else if (this.cryptoProvider === CRYPTO_PROVIDERS.HYPERLIQUID)
            this.suggestionsGroup.description = 'Search Hyperliquid perpetual markets, then choose a ticker.';
        else
            this.suggestionsGroup.description = 'Search Kraken spot pairs, then choose a ticker.';
    }

    async _loadCryptoCatalog() {
        const provider = this.cryptoProvider;

        try {
            const catalog = provider === CRYPTO_PROVIDERS.HYPERLIQUID
                ? await loadHyperliquidMarkets()
                : await loadKrakenSpotPairs();
            if (this.dialog && provider === this.cryptoProvider) {
                this.cryptoCatalog = catalog;
                this._renderSuggestions();
            }
        } catch (error) {
            if (this.dialog && provider === this.cryptoProvider) {
                this.cryptoCatalogError = error.message;
                this._renderSuggestions();
            }
        }
    }

    _renderSuggestions() {
        this.suggestionRows.splice(0).forEach(row => this.suggestionsGroup.remove(row));

        const query = this.searchRow.text.trim();
        if (this.assetCategory === ASSET_CATEGORIES.CRYPTO && this.cryptoCatalog === null && !this.cryptoCatalogError) {
            this._addInfoRow('Loading markets', 'The provider catalog is being loaded.');
            return;
        }

        if (this.assetCategory === ASSET_CATEGORIES.CRYPTO && this.cryptoCatalogError) {
            this._addInfoRow('Catalog unavailable', this.cryptoCatalogError);
            return;
        }

        if (query === '') {
            this._addInfoRow('Start typing to search', 'Catalog matches appear here.');
            return;
        }

        const matches = matchCuratedTickers(this.assetCategory, query, {
            cryptoCatalog: this.cryptoCatalog,
            cryptoProvider: this.cryptoProvider,
        });
        matches.slice(0, MAX_SUGGESTIONS).forEach(ticker => {
            const row = new Adw.ActionRow({
                title: ticker.label,
                subtitle: `${ticker.liveSymbol ?? ticker.symbol} · ${ticker.priceDecimals} decimals`,
            });
            const useButton = new Gtk.Button({label: 'Use', valign: Gtk.Align.CENTER});
            useButton.connect('clicked', () => this._selectTicker(ticker));
            row.add_suffix(useButton);
            this.suggestionsGroup.add(row);
            this.suggestionRows.push(row);
        });

        if (matches.length === 0)
            this._addInfoRow('No matches', 'Try another label or symbol.');
        else if (matches.length > MAX_SUGGESTIONS)
            this._addInfoRow(`Showing first ${MAX_SUGGESTIONS} matches`, 'Keep typing to narrow the results.');
    }

    _addInfoRow(title, subtitle) {
        const row = new Adw.ActionRow({title, subtitle});
        this.suggestionsGroup.add(row);
        this.suggestionRows.push(row);
    }

    _buildTicker() {
        const ticker = {
            label: this.selectedTicker.label,
            symbol: this.selectedTicker.symbol,
            priceDecimals: this.decimalsRow.value,
            assetCategory: this.assetCategory,
            panelSide: this.sideOptions[this.sideRow.selected].value,
        };

        if (this.assetCategory === ASSET_CATEGORIES.CRYPTO) {
            ticker.cryptoProvider = this.cryptoProvider;
            ticker.liveSymbol = this.selectedTicker.liveSymbol;
        }

        return ticker;
    }
}

function createComboRow({title, options, selectedValue}) {
    const row = new Adw.ComboRow({
        title,
        model: Gtk.StringList.new(options.map(option => option.title)),
    });
    row.selected = Math.max(0, options.findIndex(option => option.value === selectedValue));
    return row;
}

export function presentTickerDialog(options) {
    new TickerDialogController(options).present();
}
