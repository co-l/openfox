import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: resolve(__dirname),
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  globalSetup: resolve(__dirname, 'setup/global-setup.ts'),
  use: {
    baseURL: 'http://localhost:10569',
    trace: 'on-first-retry',
    browserName: 'chromium',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'OPENFOX_PORT=10669 OPENFOX_DB_PATH=:memory: OPENFOX_MOCK_LLM=true npm run dev',
    url: 'http://localhost:10669',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
