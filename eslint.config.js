// Flat ESLint config — Phase 0 guardrails. The headline value is
// react-hooks/rules-of-hooks, which auto-catches the "hook after an early
// return" crash class (React #310) that was previously guarded by a manual
// `awk` scan. It is 'error' for ALL new/other code. The ~15 pre-existing
// legacy offenders (a "guard clause before the hooks" pattern, currently masked
// by upstream route-gating so they don't crash in practice) are BASELINED to
// 'warn' below and will be fixed when each page is restructured (plan Phase 4).
// Style/any/exhaustive-deps rules are intentionally OFF for now (tighten later).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// Legacy files with the guard-clause-before-hooks pattern (baseline → warn).
// Remove entries as each page is restructured in Phase 4.
const HOOK_BASELINE = [
  'src/features/hrms/letters/HrLetterGeneratorPage.tsx',
  'src/features/hrms/leave/LeaveYearEndPage.tsx',
  'src/features/hrms/leave/AdminCompOffPage.tsx',
  'src/features/hrms/training/AdminTrainingPage.tsx',
  'src/features/hrms/salary/AdminSalaryHistoryPage.tsx',
  'src/features/hrms/helpdesk/AdminHelpdeskPage.tsx',
  'src/features/hrms/assets/AssetsPage.tsx',
  'src/features/hrms/dataimport/DataImportPage.tsx',
  'src/features/hrms/recruitment/RecruitmentPage.tsx',
  'src/features/crm/admin/AccessLogsPage.tsx',
  'src/features/crm/admin/CommissionLeakagePage.tsx',
  'src/features/crm/admin/DocumentTypesPage.tsx',
  'src/features/crm/admin/EligibilityRulesPage.tsx',
  'src/features/crm/admin/ProvidersPage.tsx',
  'src/features/crm/admin/WebhookConfigPage.tsx',
];

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
  {
    // Baseline: pre-existing hook-order debt → warn (see HOOK_BASELINE note above).
    files: HOOK_BASELINE,
    rules: { 'react-hooks/rules-of-hooks': 'warn' },
  },
];
