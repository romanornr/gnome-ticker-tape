import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {
    DEFAULT_DISPLAY_SETTINGS,
    getFontPresetStyle,
    getSeparatorText,
} from '../utils/display-settings.js';
import {getDensityFontScale, shouldFitFontPreset} from '../utils/display-density.js';

const DIMMED_OPACITY = 166;

/* Turns quote entry fragments and display settings into GNOME Shell actors. */
export const TickerIndicator = GObject.registerClass(
class TickerIndicator extends PanelMenu.Button {
    _init(openPreferences) {
        super._init(0.0, 'Ticker Indicator', false);

        this._openPreferences = openPreferences;
        this._content = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._content);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Settings', () => {
            this.menu.close();
            this._openPreferences();
        });
    }

    setEntries(entries, displaySettings = DEFAULT_DISPLAY_SETTINGS) {
        this._content.destroy_all_children();
        const contentScale = Number.isFinite(displaySettings.fontScaleOverride)
            ? displaySettings.fontScaleOverride
            : getDensityFontScale(entries, displaySettings);
        this._content.style = contentScale < 1 ? `font-size: ${contentScale}em;` : '';
        const fontStyle = getFontPresetStyle(displaySettings.fontPreset);
        const createLabel = shouldFitFontPreset(displaySettings.fontPreset)
            ? createFittedTickerLabel
            : createTickerLabel;
        const separator = getSeparatorText(displaySettings.separatorStyle);

        entries.forEach((entry, index) => {
            if (index > 0) {
                this._content.add_child(createLabel({
                    text: separator,
                    style: buildLabelStyle({fontStyle}),
                    opacity: DIMMED_OPACITY,
                }));
            }

            this._content.add_child(createLabel({
                text: entry.label,
                style: buildLabelStyle({weight: 500, fontStyle}),
            }));

            if (displaySettings.showPrice) {
                this._content.add_child(createLabel({
                    text: ` ${entry.priceText}`,
                    style: buildLabelStyle({
                        color: entry.priceColor,
                        fontStyle,
                    }),
                    opacity: entry.isStale ? DIMMED_OPACITY : 255,
                }));
            }

            if (displaySettings.showArrow && entry.arrow) {
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

            if (displaySettings.showPercent && entry.percentText) {
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
});

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
