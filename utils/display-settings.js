/* Display defaults and option lists shared by prefs and panel rendering. */

export const SEPARATOR_STYLES = {
    DOT: 'dot',
    PIPES: 'pipes',
    SPACE: 'space',
};

export const FONT_PRESETS = {
    SYSTEM: 'system',
    MONOSPACE: 'monospace',
    IBM_PLEX_MONO: 'ibm-plex-mono',
    JETBRAINS_MONO: 'jetbrains-mono',
    INTER: 'inter',
};

export const DEFAULT_REFRESH_INTERVAL_SECONDS = 300;

export const DEFAULT_DISPLAY_SETTINGS = {
    showPrice: true,
    showArrow: true,
    showPercent: true,
    separatorStyle: SEPARATOR_STYLES.DOT,
    fontPreset: FONT_PRESETS.SYSTEM,
};

export function getSeparatorText(separatorStyle) {
    switch (separatorStyle) {
    case SEPARATOR_STYLES.PIPES:
        return ' || ';
    case SEPARATOR_STYLES.SPACE:
        return '   ';
    case SEPARATOR_STYLES.DOT:
    default:
        return ' \u00b7 ';
    }
}

export function getSeparatorOptions() {
    return [
        {value: SEPARATOR_STYLES.DOT, title: '\u00b7'},
        {value: SEPARATOR_STYLES.PIPES, title: '||'},
        {value: SEPARATOR_STYLES.SPACE, title: 'Spacing'},
    ];
}

export function getFontPresetOptions() {
    return [
        {value: FONT_PRESETS.SYSTEM, title: 'System'},
        {value: FONT_PRESETS.MONOSPACE, title: 'System monospace'},
        {value: FONT_PRESETS.IBM_PLEX_MONO, title: 'IBM Plex Mono'},
        {value: FONT_PRESETS.JETBRAINS_MONO, title: 'JetBrains Mono'},
        {value: FONT_PRESETS.INTER, title: 'Inter'},
    ];
}

export function getFontPresetStyle(fontPreset) {
    switch (fontPreset) {
    case FONT_PRESETS.MONOSPACE:
        return {
            fontFamily: 'monospace',
            fontFeatureSettings: '"tnum"',
        };
    case FONT_PRESETS.IBM_PLEX_MONO:
        return {
            fontFamily: '"IBM Plex Mono", monospace',
            fontFeatureSettings: '"tnum"',
        };
    case FONT_PRESETS.JETBRAINS_MONO:
        return {
            fontFamily: '"JetBrains Mono", monospace',
            fontFeatureSettings: '"tnum"',
        };
    case FONT_PRESETS.INTER:
        return {
            fontFamily: '"Inter Tight", "Inter", sans-serif',
            fontFeatureSettings: '"tnum"',
        };
    case FONT_PRESETS.SYSTEM:
    default:
        return {};
    }
}

export function getRefreshIntervalOptions() {
    return [60, 120, 300, 600, 900, 1800, 3600];
}

export function formatRefreshIntervalLabel(seconds) {
    if (seconds < 60)
        return `${seconds} sec`;

    const minutes = seconds / 60;
    return `${minutes} min`;
}
