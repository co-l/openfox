import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Long timeouts for real LLM calls
    testTimeout: 120_000,      // 2 minutes per test
    hookTimeout: 60_000,       // 1 minute for setup/teardown
    
    // Run tests sequentially to avoid port conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    
    // Global setup to verify vLLM is reachable
    globalSetup: './setup.ts',
    
    // Include all test files in this directory
    include: ['./*.test.ts'],
    
    // Explicit root
    root: '.',
    
    // Retry flaky tests once (network issues, etc.)
    retry: 1,
  },
})
