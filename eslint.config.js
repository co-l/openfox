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
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-function': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-useless-assignment': 'warn',
      'no-useless-catch': 'warn',
      'no-unsafe-finally': 'warn',
      'require-yield': 'warn',
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
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
    },
  },
)
