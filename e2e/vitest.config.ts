import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 2_000,
    hookTimeout: 10_000,
    
    // Run tests serially to avoid shared mock-server cross-talk
    pool: 'forks',
    maxWorkers: 1,
    
    // Global setup starts mock server
    globalSetup: './setup.ts',
    
    // Include all test files
    include: ['./*.test.ts'],
    root: '.',
    
    // No retries needed with deterministic mock
    retry: 0,
  },
})
