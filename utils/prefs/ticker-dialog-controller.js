/*
 * This preferences-process module maps dialog state and provider-backed validation into saved ticker configs.
 * Shell actors stay outside this directory so prefs and GNOME Shell keep separate toolkit dependency graphs.
 */
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup?version=3.0';

import {
    buildCatalogSuggestionRows,
    loadCryptoCatalog,
} from './catalog-suggestions.js';
import {
    buildTickerConfig,
    getCatalogMatches,
    getCatalogSearchQuery,
    getSuggestionsDescription,
    resolveSelectedCryptoTicker,
    validateTickerDraft,
    validateTickerSymbol,
} from './ticker-dialog-state.js';
import {verifySymbol as verifyTickerSymbol} from '../../services/providers/rest-quotes.js';
import {
    getDefaultCryptoProvider,
    getTickerMarketSessionOptions,
    getTickerMarketSessionPolicy,
} from '../asset-categories.js';
import {LEFT_PANEL_SIDE, RIGHT_PANEL_SIDE} from '../panel-sides.js';

const MAX_CURATED_SUGGESTIONS = 8;

/*
 * TickerDialogController owns mutable dialog state, catalog search, non-crypto verification, and save wiring.
 * It owns the catalog and verification request lifecycle while prefs.js retains page layout and row actions.
 */
export class TickerDialogController {
    constructor({
        window,
        title,
        initialTicker,
        onSave,
        assetCategoryOptions,
        cryptoProviderOptions,
        createComboRow,
        createTextButton,
        findOptionIndex,
        verifySymbol = verifyTickerSymbol,
    }) {
        this.window = window;
        this.title = title;
        this.initialTicker = initialTicker;
        this.onSave = onSave;
        this.assetCategoryOptions = assetCategoryOptions;
        this.cryptoProviderOptions = cryptoProviderOptions;
        this.createComboRow = createComboRow;
        this.createTextButton = createTextButton;
        this.findOptionIndex = findOptionIndex;
        this.verifySymbol = verifySymbol;

        this.activeAssetCategory = initialTicker.assetCategory ?? assetCategoryOptions[0].value;
        this.activeMarketSessionId = getTickerMarketSessionPolicy({...initialTicker, assetCategory: this.activeAssetCategory}).marketSessionId;
        this.activeCryptoProvider = this.activeAssetCategory === 'crypto'
            ? initialTicker.cryptoProvider ?? getDefaultCryptoProvider()
            : '';
        this.marketSessionOptions = getTickerMarketSessionOptions({...initialTicker, assetCategory: this.activeAssetCategory});
        this.cryptoCatalog = null;
        this.cryptoCatalogProvider = '';
        this.cryptoCatalogError = '';
        this.cryptoCatalogLoading = false;
        this.cryptoCatalogRequestId = 0;
        this.autoFilledCryptoLabel = initialTicker.label ?? '';
        this.verifyInProgress = false;
        this.lastVerifiedSymbol = '';
        this.verificationRequestId = 0;
        this.verificationSession = new Soup.Session();
        this.suggestionRows = [];

        this._buildUi();
        this._connectSignals();
    }

    /* present() keeps the exported API small while the class owns the full GTK lifecycle. */
    present() {
        this._updateSuggestionsDescription();
        this._syncMarketSessionRow();
        if (this.activeAssetCategory === 'crypto')
            void this._ensureCryptoCatalogLoaded();
        this._renderCuratedSuggestions();
        this._updateSaveSensitivity();
        this.dialog.present(this.window);
    }

    /* This composition boundary builds the Adw hierarchy before _connectSignals() wires state transitions. */
    _buildUi() {
        this.dialog = new Adw.Dialog({title: this.title});
        this.dialog.set_content_width(680);
        this.dialog.set_content_height(680);

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

        this.assetCategoryRow = this.createComboRow({
            title: 'Asset type',
            options: this.assetCategoryOptions,
            selectedValue: this.activeAssetCategory,
        });
        formGroup.add(this.assetCategoryRow);

        this.marketSessionModel = Gtk.StringList.new(this.marketSessionOptions.map(option => option.title));
        this.marketSessionRow = new Adw.ComboRow({title: 'Market session', model: this.marketSessionModel});
        this.marketSessionRow.selected = Math.max(0, this.marketSessionOptions.findIndex(option => option.value === this.activeMarketSessionId));
        formGroup.add(this.marketSessionRow);

        this.cryptoProviderRow = this.createComboRow({
            title: 'Crypto API',
            subtitle: 'Kraken supports spot pairs. Hyperliquid supports spot symbols and perps.',
            options: this.cryptoProviderOptions,
            selectedValue: this.activeCryptoProvider || getDefaultCryptoProvider(),
        });
        this.cryptoProviderRow.visible = this.activeAssetCategory === 'crypto';
        formGroup.add(this.cryptoProviderRow);

        this.searchRow = new Adw.EntryRow({title: 'Search catalog'});
        formGroup.add(this.searchRow);

        const labelField = this._createReadOnlyTextRow('Name', this.initialTicker.label ?? '');
        this.labelRow = labelField.row;
        this.labelValueLabel = labelField.valueLabel;
        formGroup.add(this.labelRow);

        const symbolField = this._createReadOnlyTextRow(
            'Symbol',
            this.activeAssetCategory === 'crypto'
                ? this.initialTicker.liveSymbol ?? this.initialTicker.symbol ?? ''
                : this.initialTicker.symbol ?? ''
        );
        this.symbolRow = symbolField.row;
        this.symbolValueLabel = symbolField.valueLabel;
        formGroup.add(this.symbolRow);

        this.verifyButton = this.createTextButton('Verify', () => {
            void this._runSymbolVerification();
        });
        this.symbolRow.add_suffix(this.verifyButton);

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
        this.sideRow = this.createComboRow({
            title: 'Panel side',
            options: this.sideOptions,
            selectedValue: this.initialTicker.panelSide ?? RIGHT_PANEL_SIDE,
        });
        formGroup.add(this.sideRow);

        this.suggestionsGroup = new Adw.PreferencesGroup({
            title: 'Catalog matches',
            description: 'Search the catalog above, then choose a match to fill the ticker fields.',
        });
        content.append(this.suggestionsGroup);

        this.errorLabel = new Gtk.Label({halign: Gtk.Align.START, wrap: true, visible: false});
        this.errorLabel.add_css_class('error');
        content.append(this.errorLabel);

        this.verificationLabel = new Gtk.Label({halign: Gtk.Align.START, wrap: true, visible: false});
        this.verificationLabel.add_css_class('dim-label');
        content.append(this.verificationLabel);
    }

    /* All widget signals feed into instance methods so state transitions stay grouped by responsibility. */
    _connectSignals() {
        this.assetCategoryRow.connect('notify::selected', widget => {
            const option = this.assetCategoryOptions[widget.selected];
            if (!option)
                return;

            this.activeAssetCategory = option.value;
            /* The symbol travels with the category because a listed fund's default follows its venue, not its type. */
            this.activeMarketSessionId = getTickerMarketSessionPolicy({
                assetCategory: this.activeAssetCategory,
                symbol: this._getSymbolText(),
            }).defaultMarketSessionId;
            this.activeCryptoProvider = this.activeAssetCategory === 'crypto'
                ? this.activeCryptoProvider || getDefaultCryptoProvider()
                : '';
            this._resetCryptoCatalogState();
            this._clearVerificationState();
            this._syncMarketSessionRow();
            this.cryptoProviderRow.visible = this.activeAssetCategory === 'crypto';
            if (this.activeAssetCategory === 'crypto')
                this.cryptoProviderRow.selected = this.findOptionIndex(this.cryptoProviderOptions, this.activeCryptoProvider);
            this._updateSuggestionsDescription();
            if (this.activeAssetCategory === 'crypto')
                void this._ensureCryptoCatalogLoaded();
            this._renderCuratedSuggestions();
            this._updateSaveSensitivity();
        });

        this.marketSessionRow.connect('notify::selected', widget => {
            const option = this.marketSessionOptions[widget.selected];
            if (!option)
                return;

            this.activeMarketSessionId = option.value;
        });

        this.cryptoProviderRow.connect('notify::selected', widget => {
            const option = this.cryptoProviderOptions[widget.selected];
            if (!option)
                return;

            this.activeCryptoProvider = option.value;
            this._resetCryptoCatalogState();
            this._clearVerificationState();
            this._updateSuggestionsDescription();
            if (this.activeAssetCategory === 'crypto')
                void this._ensureCryptoCatalogLoaded();
            this._renderCuratedSuggestions();
            this._updateSaveSensitivity();
        });

        this.searchRow.connect('notify::text', () => {
            this._renderCuratedSuggestions();
        });

        this.cancelButton.connect('clicked', () => {
            this.dialog.close();
        });

        this.saveButton.connect('clicked', () => {
            this.onSave(this._buildNextTicker());
            this.dialog.close();
        });

        this.dialog.connect('closed', () => {
            this.dialog = null;
            this.cryptoCatalogRequestId += 1;
            this.verificationRequestId += 1;
            this.verificationSession.abort();
        });
    }

    /* Choosing a suggestion updates both the visible form fields and the controller's hidden runtime state. */
    _applyCuratedTicker(curatedTicker) {
        this._setLabelText(curatedTicker.label);
        this._setSymbolText(curatedTicker.assetCategory === 'crypto'
            ? curatedTicker.liveSymbol ?? curatedTicker.symbol
            : curatedTicker.symbol);
        this.decimalsRow.value = curatedTicker.priceDecimals;
        this.activeAssetCategory = curatedTicker.assetCategory;
        this.activeMarketSessionId = getTickerMarketSessionPolicy(curatedTicker).marketSessionId;
        this.activeCryptoProvider = curatedTicker.assetCategory === 'crypto'
            ? curatedTicker.cryptoProvider ?? getDefaultCryptoProvider()
            : '';
        this.assetCategoryRow.selected = this.findOptionIndex(this.assetCategoryOptions, curatedTicker.assetCategory);
        this.cryptoProviderRow.selected = this.findOptionIndex(this.cryptoProviderOptions, this.activeCryptoProvider);
        this._syncMarketSessionRow();
        this.cryptoProviderRow.visible = this.activeAssetCategory === 'crypto';
        if (this.activeAssetCategory === 'crypto')
            this.autoFilledCryptoLabel = curatedTicker.label;
        this._updateSaveSensitivity();
    }

    /* Read-only text rows avoid editable affordances while keeping selected catalog values visible. */
    _createReadOnlyTextRow(title, text) {
        const row = new Adw.ActionRow({title, activatable: false});
        const valueLabel = new Gtk.Label({
            ellipsize: Pango.EllipsizeMode.END,
            halign: Gtk.Align.END,
            hexpand: true,
            label: text,
            selectable: true,
            single_line_mode: true,
            xalign: 1,
        });
        valueLabel.add_css_class('dim-label');
        row.add_suffix(valueLabel);

        return {row, valueLabel};
    }

    _getLabelText() {
        return this.labelValueLabel.label;
    }

    _setLabelText(text) {
        this.labelValueLabel.label = text;
        this._updateSaveSensitivity();
    }

    _getSymbolText() {
        return this.symbolValueLabel.label;
    }

    _setSymbolText(text) {
        this.symbolValueLabel.label = text;
        this._handleSymbolTextChanged();
    }

    _handleSymbolTextChanged() {
        const symbolText = this._getSymbolText();
        const normalizedSymbolText = this.activeAssetCategory === 'crypto'
            ? symbolText.trim()
            : symbolText.trim().toLowerCase();

        if (this.verifyInProgress || normalizedSymbolText !== this.lastVerifiedSymbol)
            this._clearVerificationState();

        if (this.activeAssetCategory === 'crypto') {
            const resolvedCryptoTicker = this._getResolvedCryptoTicker();
            const labelText = this._getLabelText();
            if (labelText.trim() === '' || labelText.trim() === this.autoFilledCryptoLabel) {
                if (resolvedCryptoTicker) {
                    this.autoFilledCryptoLabel = resolvedCryptoTicker.label;
                    this._setLabelText(resolvedCryptoTicker.label);
                    this.decimalsRow.value = resolvedCryptoTicker.priceDecimals;
                }
            }
        }

        this._updateSaveSensitivity();
    }

    /* Market-session selection stays editable and follows the current asset type. */
    _syncMarketSessionRow() {
        this.marketSessionOptions = getTickerMarketSessionOptions({
            assetCategory: this.activeAssetCategory,
            marketSessionId: this.activeMarketSessionId,
            symbol: this._getSymbolText(),
        });
        this.marketSessionModel.splice(0, this.marketSessionModel.get_n_items(), this.marketSessionOptions.map(option => option.title));
        this.marketSessionRow.selected = Math.max(0, this.marketSessionOptions.findIndex(option => option.value === this.activeMarketSessionId));
    }

    /* Verification status is funneled through one helper so async branches update the UI consistently. */
    _setVerificationMessage(message, isError = false) {
        this.verificationLabel.visible = message !== '';
        this.verificationLabel.label = message;

        if (isError)
            this.verificationLabel.add_css_class('error');
        else
            this.verificationLabel.remove_css_class('error');
    }

    /* Any edit that invalidates the previous verification result resets the dialog's verification state here. */
    _clearVerificationState() {
        this.verificationRequestId += 1;
        this.verifyInProgress = false;
        this.lastVerifiedSymbol = '';
        this._setVerificationMessage('');
    }

    /* Suggestion rows are recreated from scratch on each state change, so row teardown is centralized here. */
    _clearSuggestionRows() {
        this.suggestionRows.splice(0).forEach(row => this.suggestionsGroup.remove(row));
    }

    /* Provider or asset-type changes invalidate the previously loaded crypto catalog through this reset helper. */
    _resetCryptoCatalogState() {
        this.cryptoCatalog = null;
        this.cryptoCatalogProvider = '';
        this.cryptoCatalogError = '';
        this.cryptoCatalogLoading = false;
        this.cryptoCatalogRequestId += 1;
    }

    /* The suggestions group description follows current asset/provider mode so the dialog explains the active search source. */
    _updateSuggestionsDescription() {
        this.suggestionsGroup.description = getSuggestionsDescription(this.activeAssetCategory, this.activeCryptoProvider);
    }

    /* Crypto validation and save logic share this resolver for the selected or confidently inferred market. */
    _getResolvedCryptoTicker() {
        return resolveSelectedCryptoTicker({
            assetCategory: this.activeAssetCategory,
            cryptoCatalog: this.cryptoCatalog,
            cryptoProvider: this.activeCryptoProvider,
            labelText: this._getLabelText(),
            symbolText: this._getSymbolText(),
        });
    }

    /*
     * The dialog loads crypto catalogs lazily because provider-backed market
     * lists are runtime data, not static prefs metadata. Request ids guard
     * against stale async responses after provider changes or dialog teardown.
     */
    async _ensureCryptoCatalogLoaded() {
        if (this.activeAssetCategory !== 'crypto' || this.cryptoCatalogLoading)
            return;

        if (Array.isArray(this.cryptoCatalog) && this.cryptoCatalogProvider === this.activeCryptoProvider)
            return;

        this.cryptoCatalogLoading = true;
        this.cryptoCatalogError = '';
        this._renderCuratedSuggestions();
        this._updateSaveSensitivity();

        const requestedCryptoProvider = this.activeCryptoProvider;
        this.cryptoCatalogRequestId += 1;
        const requestId = this.cryptoCatalogRequestId;

        try {
            const loadedCryptoCatalog = await loadCryptoCatalog(requestedCryptoProvider);
            if (this._isStaleCryptoCatalogResponse(requestId, requestedCryptoProvider))
                return;

            this.cryptoCatalog = loadedCryptoCatalog;
            this.cryptoCatalogProvider = requestedCryptoProvider;
            this.cryptoCatalogError = '';
        } catch (error) {
            if (this._isStaleCryptoCatalogResponse(requestId, requestedCryptoProvider))
                return;

            this.cryptoCatalog = null;
            this.cryptoCatalogProvider = '';
            this.cryptoCatalogError = error.message;
        } finally {
            if (!this._isStaleCryptoCatalogResponse(requestId, requestedCryptoProvider)) {
                this.cryptoCatalogLoading = false;
                this._renderCuratedSuggestions();
                this._updateSaveSensitivity();
            }
        }
    }

    /* Async catalog responses are discarded when the dialog closed or the provider changed mid-flight. */
    _isStaleCryptoCatalogResponse(requestId, requestedCryptoProvider) {
        return this.dialog === null ||
            requestId !== this.cryptoCatalogRequestId ||
            this.activeCryptoProvider !== requestedCryptoProvider;
    }

    /* Suggestion rendering is the UI projection of the pure catalog-suggestion models. */
    _renderCuratedSuggestions() {
        this._clearSuggestionRows();
        buildCatalogSuggestionRows({
            assetCategory: this.activeAssetCategory,
            cryptoProvider: this.activeCryptoProvider,
            cryptoCatalog: this.cryptoCatalog,
            cryptoCatalogLoading: this.cryptoCatalogLoading,
            cryptoCatalogError: this.cryptoCatalogError,
            searchText: this.searchRow.text,
            maxSuggestions: MAX_CURATED_SUGGESTIONS,
        }).forEach(rowModel => {
            const row = new Adw.ActionRow({title: rowModel.title, subtitle: rowModel.subtitle, sensitive: rowModel.kind === 'match'});

            if (rowModel.kind === 'match') {
                row.add_suffix(this.createTextButton('Use', () => {
                    this._applyCuratedTicker(rowModel.curatedTicker);
                }));
            }

            this.suggestionsGroup.add(row);
            this.suggestionRows.push(row);
        });
    }

    /* Verify is a live non-crypto quote check; crypto validity already comes from the loaded catalog. */
    _updateVerifyButtonSensitivity() {
        const canVerify = this.activeAssetCategory !== 'crypto';
        this.verifyButton.visible = canVerify;
        this.verifyButton.set_sensitive(
            canVerify &&
            this._getSymbolText().trim() !== '' &&
            !this.verifyInProgress
        );
    }

    /*
     * Non-crypto symbols round-trip through the same REST provider chain the
     * runtime refresh uses. Crypto validity is enforced by Save instead.
     */
    async _runSymbolVerification() {
        if (this.activeAssetCategory === 'crypto')
            return;

        const symbol = this._getSymbolText().trim().toLowerCase();
        const symbolValidationMessage = validateTickerSymbol(symbol);

        if (symbolValidationMessage !== '') {
            this._setVerificationMessage(symbolValidationMessage, true);
            this._updateVerifyButtonSensitivity();
            return;
        }

        this.verificationRequestId += 1;
        const requestId = this.verificationRequestId;
        this.verifyInProgress = true;
        this._updateVerifyButtonSensitivity();
        this._setVerificationMessage(`Checking ${symbol}...`);

        try {
            const result = await this.verifySymbol(this.verificationSession, symbol, this.activeAssetCategory);
            if (requestId !== this.verificationRequestId)
                return;

            this.lastVerifiedSymbol = symbol;
            this._setVerificationMessage(
                `Verified ${result.symbol}. Quote data dated ${result.quoteDate}.`
            );
        } catch (error) {
            if (requestId !== this.verificationRequestId)
                return;

            this.lastVerifiedSymbol = '';
            this._setVerificationMessage(error.message, true);
        } finally {
            if (requestId === this.verificationRequestId) {
                this.verifyInProgress = false;
                this._updateVerifyButtonSensitivity();
            }
        }
    }

    /* Save sensitivity mirrors the pure dialog-state validation rules into the live GTK button and error UI. */
    _updateSaveSensitivity() {
        const hasCryptoCatalogMatches = this.activeAssetCategory === 'crypto' &&
            getCatalogMatches(
                this.activeAssetCategory,
                getCatalogSearchQuery(this.searchRow.text),
                this.cryptoCatalog,
                this.activeCryptoProvider
            ).length > 0;
        const validationMessage = validateTickerDraft(this._getLabelText(), this._getSymbolText(), {
            assetCategory: this.activeAssetCategory,
            cryptoProvider: this.activeCryptoProvider,
            cryptoCatalogLoading: this.cryptoCatalogLoading,
            cryptoCatalogError: this.cryptoCatalogError,
            resolvedCryptoTicker: this._getResolvedCryptoTicker(),
            hasCryptoCatalogMatches,
        });
        const isValid = validationMessage === '';
        this.saveButton.set_sensitive(isValid);
        this.errorLabel.visible = !isValid;
        this.errorLabel.label = validationMessage;
        this._updateVerifyButtonSensitivity();
    }

    /* Saving reuses the shared ticker-config builder so prefs UI state stays aligned with runtime normalization policy. */
    _buildNextTicker() {
        return buildTickerConfig({
            initialTicker: this.initialTicker,
            labelText: this._getLabelText(),
            symbolText: this._getSymbolText(),
            priceDecimals: this.decimalsRow.value,
            panelSide: this.sideOptions[this.sideRow.selected].value,
            assetCategory: this.activeAssetCategory,
            marketSessionId: this.activeMarketSessionId,
            cryptoProvider: this.activeCryptoProvider,
            resolvedCryptoTicker: this._getResolvedCryptoTicker(),
            cryptoCatalog: this.cryptoCatalog,
        });
    }
}

/* presentTickerDialog() keeps prefs.js decoupled from the controller's internal class shape. */
export function presentTickerDialog(options) {
    new TickerDialogController(options).present();
}
