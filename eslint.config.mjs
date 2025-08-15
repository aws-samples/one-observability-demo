import typescriptEslint from '@typescript-eslint/eslint-plugin';
import jest from 'eslint-plugin-jest';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default [
    ...compat.extends('plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'),
    eslintPluginUnicorn.configs.recommended,
    {
        plugins: {
            '@typescript-eslint': typescriptEslint,
            jest,
            eslintPluginUnicorn,
        },

        languageOptions: {
            globals: {
                ...jest.environments.globals.globals,
            },
            parser: tsParser,
            ecmaVersion: 2020,
            sourceType: 'module',
        },

        rules: {
            'no-new': 0,
            '@typescript-eslint/no-var-requires': 0,
        },
    },
];
