import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

export default defineConfig({
  test: {
    testTimeout: 15_000,
    hookTimeout: 10_000,
    
    // Run tests in parallel with thread pool
    // Each test file gets its own in-process server on a dynamic port
    pool: 'threads',
    maxWorkers: 5,
    
    // No global setup - each test file manages its own server
    // globalSetup: './setup.ts',  // REMOVED - using in-process servers
    
    // Include all test files (absolute path for running from project root)
    include: [`${__dirname}/*.test.ts`],
    
    // No retries needed with deterministic mock
    retry: 0,
    
    // Use tsx to resolve TypeScript imports with .js extensions
    execArgv: ['--import', 'tsx/esm'],
    
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: [`${rootDir}/src/server/**/*.ts`, `${rootDir}/src/shared/**/*.ts`],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        `${rootDir}/src/shared/index.ts`,
        `${rootDir}/src/shared/types.ts`,
        `${rootDir}/src/server/context.ts`,
        `${rootDir}/src/server/index.ts`,
        `${rootDir}/src/server/context/index.ts`,
        `${rootDir}/src/server/events/index.ts`,
        `${rootDir}/src/server/events/types.ts`,
        `${rootDir}/src/server/llm/index.ts`,
        `${rootDir}/src/server/llm/mock.ts`,
        `${rootDir}/src/server/llm/types.ts`,
        `${rootDir}/src/server/lsp/index.ts`,
        `${rootDir}/src/server/lsp/types.ts`,
        `${rootDir}/src/server/runner/index.ts`,
        `${rootDir}/src/server/session/index.ts`,
        `${rootDir}/src/server/ws/index.ts`,
      ],
    },
  },
})
