import { defineConfig } from 'vitest/config'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Globs require forward slashes; on Windows dirname/resolve produce backslashes,
// which tinyglobby treats as escape characters (include matches nothing).
const __dirname = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/')
const rootDir = resolve(__dirname, '..').replace(/\\/g, '/')

const CI_MULTIPLIER = process.env['CI'] === 'true' ? 10 : 1

// Workers are configurable so machines that can parallel-start servers do, and
// constrained ones (CI) or the unlucky can dial it down. Override with
// OPENFOX_E2E_MAX_WORKERS; invalid values fall back to the default.
export function resolveMaxWorkers(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['OPENFOX_E2E_MAX_WORKERS']
  if (raw) {
    const parsed = Number(raw)
    if (Number.isInteger(parsed) && parsed >= 1) return parsed
  }
  return env['CI'] === 'true' ? 1 : 12
}

export default defineConfig({
  test: {
    testTimeout: 15_000 * CI_MULTIPLIER,
    hookTimeout: 10_000 * CI_MULTIPLIER,

    // Run tests in parallel with fork pool
    // Each test file gets its own in-process server on a dynamic port
    pool: 'forks',
    maxWorkers: resolveMaxWorkers(),

    // Bind guard: keeps listen(0) off the ports fetch refuses to reach.
    setupFiles: [`${__dirname}/../test-port-guard.ts`],

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
