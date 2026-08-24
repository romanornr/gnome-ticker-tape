import {defineConfig, globalIgnores} from 'eslint/config';
import gnome from 'eslint-config-gnome';

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
            'no-nested-ternary': 'off',
            'nonblock-statement-body-position': 'off',
            'object-curly-newline': 'off',
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
