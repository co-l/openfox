import { defineConfig } from 'vitest/config'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    testTimeout: 2_000,
    hookTimeout: 15_000, // Increased for server startup
    
    // Run tests in parallel with thread pool
    // Each test file gets its own in-process server on a dynamic port
    pool: 'threads',
    maxWorkers: 7,
    
    // No global setup - each test file manages its own server
    // globalSetup: './setup.ts',  // REMOVED - using in-process servers
    
    // Include all test files (absolute path for running from project root)
    include: [`${__dirname}/*.test.ts`],
    
    // No retries needed with deterministic mock
    retry: 0,
  },
})
