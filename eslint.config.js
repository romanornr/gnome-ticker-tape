import {defineConfig, globalIgnores} from 'eslint/config';
import gnome from 'eslint-config-gnome';

const gnomeRestrictedSyntax = gnome.configs.recommended[1].rules['no-restricted-syntax'].slice(1);

export default defineConfig([
    globalIgnores([
        '.agents/**',
        '.brv/**',
        '.claude/**',
        '.codex/**',
        '.gitnexus/**',
        'dist/**',
        'node_modules/**',
    ]),
    gnome.configs.recommended,
    {
        languageOptions: {
            globals: {
                global: 'readonly',
            },
        },
        rules: {
            // CODE_STYLE_GUIDE.md permits compact guards and short objects.
            'max-len': ['error', {code: 200}],
            'no-empty': ['error', {allowEmptyCatch: false}],
            'no-nested-ternary': 'off',
            'nonblock-statement-body-position': 'off',
            'object-curly-newline': 'off',
            'no-restricted-syntax': [
                'error',
                ...gnomeRestrictedSyntax,
                {
                    selector: 'CallExpression[optional=true]',
                    message: 'Call guaranteed methods directly; do not use optional calls',
                },
                {
                    selector: 'CatchClause > BlockStatement[body.length=0]',
                    message: 'Do not swallow errors in an empty or comment-only catch block',
                },
                {
                    selector: 'Identifier[name=/^_(destroyed|enabled)$/]',
                    message: 'Fix lifecycle ownership instead of guarding it with a boolean flag',
                },
                {
                    selector: 'CallExpression[callee.object.type="ThisExpression"][callee.property.name="connect"][arguments.0.value="destroy"]',
                    message: 'Override a widget\'s destroy() method instead of connecting it to its own destroy signal',
                },
                {
                    selector: 'CallExpression[callee.property.name="getSettings"][arguments.length!=0]',
                    message: 'Declare settings-schema in metadata.json and call getSettings() without arguments',
                },
            ],
        },
    },
    {
        files: ['providers/**/*.js', 'utils/**/*.js'],
        ignores: ['utils/prefs/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [{
                    group: ['gi://Adw', 'gi://Clutter', 'gi://Gdk', 'gi://Gtk', 'gi://St', 'resource:///org/gnome/shell/ui/**'],
                    message: 'Process-neutral modules must not import process-specific UI libraries',
                }],
            }],
        },
    },
    {
        files: ['prefs.js', 'utils/prefs/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [{
                    group: ['gi://Clutter', 'gi://St', 'resource:///org/gnome/shell/ui/**'],
                    message: 'Preferences modules must not import Shell UI libraries',
                }],
            }],
        },
    },
    {
        files: ['extension.js', 'services/**/*.js', 'ui/**/*.js'],
        rules: {
            'no-restricted-imports': ['error', {
                patterns: [{
                    group: ['gi://Adw', 'gi://Gdk', 'gi://Gtk', 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'],
                    message: 'Shell runtime modules must not import preferences UI libraries',
                }],
            }],
        },
    },
    {
        files: ['tests/**/*.js'],
        rules: {
            // Tests use sequential awaits and interface-compatible async fakes deliberately.
            'no-await-in-loop': 'off',
            'require-await': 'off',
        },
    },
]);
