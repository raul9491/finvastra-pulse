// Flat ESLint config — Phase 0 guardrails. The headline value is
// react-hooks/rules-of-hooks, which auto-catches the "hook after an early
// return" crash class (React #310) that was previously guarded by a manual
// `awk` scan. It is 'error' EVERYWHERE — the 123-violation legacy baseline
// (15 files with a guard clause above their hooks) was fully cleared on
// 2026-07-22, so there is no exemption list any more. Keep it that way: put
// an access guard in a thin wrapper component, or below every hook.
// Style/any/exhaustive-deps rules are intentionally OFF for now (tighten later).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';


export default [
  {
    ignores: [
      'dist/**', 'node_modules/**', 'emulator-data/**', 'coverage/**',
      'public/**', '.qa/**', 'scripts/**', '**/*.mjs', '**/*.cjs', 'vite.config.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },  // stale exhaustive-deps disables
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      // ── The headline guardrail ──────────────────────────────────────────────
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',        // too noisy for now
      // ── Off: TS handles it, or too noisy / stylistic for Phase 0 ────────────
      'no-undef': 'off',
      'no-unused-vars': 'off',                      // use the TS-aware rule below
      'no-empty': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-case-declarations': 'off',
      'no-prototype-builtins': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-useless-assignment': 'off',               // dead stores — not a crash
      'no-irregular-whitespace': 'off',
      'preserve-caught-error': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrors: 'none' }],
    },
  },
];
