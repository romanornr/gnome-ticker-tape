import {
    DEFAULT_DISPLAY_SETTINGS,
    FONT_PRESETS,
    getSeparatorText,
} from './display-settings.js';

const DENSITY_SCALE_START = 90;
const DENSITY_SCALE_END = 150;
const MIN_DENSITY_FONT_SCALE = 0.88;

/* Crowded mono-font indicators scale down together so both panel sides match. */
export function shouldFitFontPreset(fontPreset) {
    switch (fontPreset) {
    case FONT_PRESETS.MONOSPACE:
    case FONT_PRESETS.IBM_PLEX_MONO:
    case FONT_PRESETS.JETBRAINS_MONO:
        return true;
    default:
        return false;
    }
}

export function getDensityFontScale(entries, displaySettings = DEFAULT_DISPLAY_SETTINGS) {
    if (!shouldFitFontPreset(displaySettings.fontPreset))
        return 1;

    const density = estimateEntriesDensity(entries, displaySettings);
    if (density <= DENSITY_SCALE_START)
        return 1;

    const progress = Math.min(1, (density - DENSITY_SCALE_START) / (DENSITY_SCALE_END - DENSITY_SCALE_START));
    const scale = 1 - (progress * (1 - MIN_DENSITY_FONT_SCALE));
    return Math.round(scale * 100) / 100;
}

export function getSharedDensityFontScale(entryGroups, displaySettings = DEFAULT_DISPLAY_SETTINGS) {
    return entryGroups.reduce((sharedScale, entries) => {
        return Math.min(sharedScale, getDensityFontScale(entries, displaySettings));
    }, 1);
}

function estimateEntriesDensity(entries, displaySettings) {
    const separator = getSeparatorText(displaySettings.separatorStyle);
    return entries.reduce((total, entry, index) => {
        let entryDensity = textDensity(index > 0 ? separator : '') + textDensity(entry.label);

        if (displaySettings.showPrice)
            entryDensity += textDensity(` ${entry.priceText}`);

        if (displaySettings.showArrow && entry.arrow)
            entryDensity += textDensity(` ${entry.arrow}`);

        if (displaySettings.showPercent && entry.percentText)
            entryDensity += textDensity(` ${entry.percentText}`);

        return total + entryDensity;
    }, 0);
}

function textDensity(text) {
    return `${text ?? ''}`.length;
}
