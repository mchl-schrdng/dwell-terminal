import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'release/**', 'test-results/**', '.*-cache/**'] },
  js.configs.recommended,
  { files: ['**/*.cjs', '**/*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['src/**/*.js', 'scripts/test-app.cjs'], languageOptions: { globals: globals.browser } },
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: 'error',
    },
  },
];
