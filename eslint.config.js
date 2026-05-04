import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'web/**', 'e2e/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-function': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-useless-assignment': 'error',
      'no-useless-catch': 'error',
      'no-unsafe-finally': 'error',
      'require-yield': 'error',
      'prefer-const': 'error',
      'no-useless-escape': 'error',
      'preserve-caught-error': 'off',
    },
  },
  // CLI files legitimately use console.log for user-facing output
  {
    files: ['src/cli/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // Test files have looser rules
  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-useless-assignment': 'off',
      'no-console': 'off',
      'require-yield': 'off',
      'prefer-const': 'off',
    },
  },
)
