import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Longer timeouts for sequential LLM tests (rate-limited)
    testTimeout: 60_000,       // 60 seconds per test
    hookTimeout: 30_000,       // 30 seconds for setup/teardown
    
    // Run tests sequentially to avoid vLLM rate limiting (429 errors)
    pool: 'forks',
    maxWorkers: 1,  // Run one test at a time
    
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
