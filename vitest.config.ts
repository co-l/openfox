import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/server/**/*.ts', 'src/shared/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        'src/shared/index.ts',
        'src/shared/types.ts',
        'src/server/context.ts',
        'src/server/index.ts',
        'src/server/context/index.ts',
        'src/server/events/index.ts',
        'src/server/events/types.ts',
        'src/server/llm/index.ts',
        'src/server/llm/mock.ts',
        'src/server/llm/types.ts',
        'src/server/lsp/index.ts',
        'src/server/lsp/types.ts',
        'src/server/runner/index.ts',
        'src/server/session/index.ts',
        'src/server/ws/index.ts',
      ],
    },
  },
})
