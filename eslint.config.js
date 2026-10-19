// ESLint v9 — flat config.
// Revive `npm run lint`. Antes el repo solo tenía config antigua (.eslintrc)
// que ESLint v9 ignora, así que el lint fallaba con "couldn't find config".
//
// Se lintea solo `src/**` (TS/TSX). Electron, tests, scripts y los scaffolds
// (vscode-extension, src-tauri) quedan fuera: tienen sus propios tsconfigs.

import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    ignores: [
      'dist/**',
      'release/**',
      'build/**',
      'node_modules/**',
      'electron/**',
      'vscode-extension/**',
      'src-tauri/**',
      'scripts/**',
      'tests/**',
      'public/**',
      'models/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // React Hooks: el valor real de tener lint aquí (detecta deps y condicionales).
      ...reactHooks.configs.recommended.rules,

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // TypeScript: reglas baratas y útiles. Evitamos `no-explicit-any` y el
      // preset `recommended` completo porque este repo usa `any` de forma
      // deliberada en los límites (IPC, payloads del agente, etc.).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',

      // Ruido de estilo: lo cubren Prettier/tsc.
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-useless-escape': 'off',
    },
  },
];
