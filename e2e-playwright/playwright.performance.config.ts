import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const port = 10771
const serverUrl = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: resolve(__dirname),
  testMatch: ['**/long-session-performance.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: resolve(__dirname, 'setup/global-setup.ts'),
  use: {
    baseURL: serverUrl,
    browserName: 'chromium',
    viewport: { width: 1450, height: 920 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `OPENFOX_PORT=${port} OPENFOX_DB_PATH=:memory: OPENFOX_MOCK_LLM=true npm run dev`,
    url: serverUrl,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      OPENFOX_DB_PATH: ':memory:',
      OPENFOX_MOCK_LLM: 'true',
      OPENFOX_E2E_SERVER_URL: serverUrl,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
