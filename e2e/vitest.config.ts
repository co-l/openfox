import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Short timeouts for local LLM (fast)
    testTimeout: 30_000,       // 30 seconds per test
    hookTimeout: 15_000,       // 15 seconds for setup/teardown
    
    // Run tests sequentially to avoid port conflicts
    pool: 'forks',
    
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
