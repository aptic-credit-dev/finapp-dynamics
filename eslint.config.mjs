import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Flat ESLint config.
 *
 * The rules that are errors rather than warnings are the ones that encode a platform rule:
 * float arithmetic on money, a second outbox, a swallowed error, and an `any` that erases a
 * tenant id are all things review has to catch every single time — so they are mechanised here.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.tsbuildinfo'],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // Fail closed: an ignored promise is an unobserved failure, and an unobserved failure in an
      // audited action means the audit trail and reality disagree.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // `any` is how a tenant id becomes a string becomes a leak.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // Interpolating a number is unambiguous and these CLIs print counts constantly. Everything else
      // the rule guards — any, never, nullish, objects stringifying to [object Object] — stays an error.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      // Money is decimal/minor-unit only (ADR-007). Nothing here can catch every float bug, but the
      // obvious ones are worth blocking at the door.
      'no-loss-of-precision': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off', // the CLIs are console programs
    },
  },

  // The CLIs and specs are scripts, not library code. `apps/api/test/**` is included here (not in a
  // separate block) so its integration spec is linted by the same projectService as everything else —
  // apps/api/tsconfig.json includes test/** and references test-runner, so its `@finapp/*` imports resolve
  // to SOURCE and lint needs no prior build. See apps/api/tsconfig.json for why the earlier eslint-only
  // project was removed.
  {
    files: [
      'tools/**/src/*-cli.ts',
      'tools/**/test/**/*.ts',
      'packages/**/test/**/*.ts',
      'apps/api/test/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // A NestJS @Module is an empty class by design — that is the whole shape of a composition root.
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },

  // Config files are not part of any tsconfig, so type-aware rules cannot run on them.
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  prettier,
);
