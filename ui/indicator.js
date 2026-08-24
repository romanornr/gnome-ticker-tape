import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {DEFAULT_DISPLAY_SETTINGS, getFontPresetStyle} from '../utils/display-settings.js';
import {getDensityFontScale, shouldFitFontPreset} from '../utils/display-density.js';

/* Separators and stale fragments keep the Shell theme color but recede through one shared opacity. */
const DIMMED_OPACITY = 166;

/*
 * TickerIndicator is the last step of the pipeline: it turns prebuilt entry
 * models into actual GNOME Shell label actors.
 *
 * It deliberately expects already-formatted entries from the quote/entry-model
 * layers, so it stays dumb about markets, providers, and formatting rules.
 */
export const TickerIndicator = GObject.registerClass(
class TickerIndicator extends PanelMenu.Button {
    /* The indicator initializes one reusable actor tree and one lightweight settings menu entry. */
    _init(openPreferences) {
        super._init(0.0, 'Ticker Indicator', false);

        this._openPreferences = openPreferences;
        this._content = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER});
        this._contentScale = 1;
        this._useFittedLabels = false;

        this.add_child(this._content);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Settings', () => {
            this.menu.close();
            this._openPreferences();
        });
    }

    /*
     * setEntries() is the final projection from entry-model output into GNOME
     * Shell actors. The indicator trusts upstream layers to have already
     * decided formatting, visibility, and colors.
     */
    setEntries(entries, displaySettings = DEFAULT_DISPLAY_SETTINGS) {
        this._content.destroy_all_children();
        this._useFittedLabels = shouldFitFontPreset(displaySettings.fontPreset);
        this._contentScale = Number.isFinite(displaySettings.fontScaleOverride)
            ? displaySettings.fontScaleOverride
            : getDensityFontScale(entries, displaySettings.fontPreset);
        this._applyContentScale();
        const fontStyle = getFontPresetStyle(displaySettings.fontPreset);
        const createLabel = this._useFittedLabels ? createFittedTickerLabel : createTickerLabel;

        entries.forEach(entry => {
            if (entry.separatorBefore) {
                this._content.add_child(createLabel({
                    text: entry.separatorBefore,
                    style: buildLabelStyle({fontStyle}),
                    opacity: DIMMED_OPACITY,
                }));
            }

            this._content.add_child(createLabel({
                text: entry.label,
                style: buildLabelStyle({weight: 500, fontStyle}),
            }));

            if (entry.showPrice) {
                this._content.add_child(createLabel({
                    text: ` ${entry.priceText}`,
                    style: buildLabelStyle({
                        color: entry.priceColor,
                        fontStyle,
                    }),
                    opacity: entry.isStale ? DIMMED_OPACITY : 255,
                }));
            }

            if (entry.showArrow) {
                this._content.add_child(createLabel({
                    text: ` ${entry.arrow}`,
                    style: buildLabelStyle({
                        color: entry.changeColor,
                        weight: 500,
                        fontSize: '0.92em',
                        fontStyle,
                    }),
                    opacity: entry.isStale ? DIMMED_OPACITY : 255,
                }));
            }

            if (entry.showPercent) {
                this._content.add_child(createLabel({
                    text: ` ${entry.percentText}`,
                    style: buildLabelStyle({
                        color: entry.changeColor,
                        weight: 500,
                        fontStyle,
                    }),
                    opacity: entry.isStale ? DIMMED_OPACITY : 255,
                }));
            }
        });
    }

    _applyContentScale() {
        this._content.style = this._contentScale < 1 ? `font-size: ${this._contentScale}em;` : '';
    }
});

/* Default fonts use GNOME Shell's normal label allocation behavior. */
function createTickerLabel({text, style, opacity = 255}) {
    return new St.Label({
        opacity,
        text,
        y_align: Clutter.ActorAlign.CENTER,
        style,
    });
}

/*
 * GNOME Shell may allocate panel children tightly when a custom font is wider
 * than the default. Disabling ellipsization preserves quote text instead of
 * turning prices into fragments such as "26,...".
 */
function createFittedTickerLabel({text, style, opacity = 255}) {
    const label = new St.Label({
        opacity,
        text,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: false,
        style,
    });
    const textActor = label.get_clutter_text();
    textActor.set_ellipsize(Pango.EllipsizeMode.NONE);
    textActor.set_line_wrap(false);

    return label;
}

/* Inline style construction keeps the panel fragment hierarchy consistent without adding stylesheet plumbing. */
function buildLabelStyle({color = null, weight = null, fontSize = null, fontStyle = {}}) {
    const parts = [];

    if (color !== null)
        parts.push(`color: ${color};`);

    if (weight !== null)
        parts.push(`font-weight: ${weight};`);

    const resolvedFontSize = fontSize ?? fontStyle.fontSize;
    if (resolvedFontSize !== null && resolvedFontSize !== undefined)
        parts.push(`font-size: ${resolvedFontSize};`);

    if (fontStyle.fontFamily)
        parts.push(`font-family: ${fontStyle.fontFamily};`);

    if (fontStyle.fontFeatureSettings)
        parts.push(`font-feature-settings: ${fontStyle.fontFeatureSettings};`);

    return parts.join(' ');
}
