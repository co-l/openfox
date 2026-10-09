import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@playwright/test'

let testProjectDir: string

// The server URL the tests talk to: an explicit env wins, then the config's
// webServer (the perf config runs its server on a non-default port, so the
// hardcoded fallback below would point at the wrong place), then the default.
function resolveServerUrl(config?: Config): string {
  if (process.env['OPENFOX_E2E_SERVER_URL']) return process.env['OPENFOX_E2E_SERVER_URL']
  const webServer = config?.webServer
  const first = Array.isArray(webServer) ? webServer[0] : webServer
  if (first?.url) return first.url
  return 'http://localhost:10669'
}

export default async function globalSetup(config?: Config) {
  console.warn('[Global Setup] Setting up...')

  // Create temporary directory for test project
  testProjectDir = join(tmpdir(), `openfox-test-${Date.now()}`)
  await mkdir(testProjectDir, { recursive: true })

  // Create minimal README.md
  await writeFile(
    join(testProjectDir, 'README.md'),
    '# Test Project\n\nThis is a test project for Playwright E2E tests.\n',
  )

  // Write placeholder — project will be created in test fixtures
  const tempFile = join(tmpdir(), 'openfox-test-project-id.json')
  await writeFile(
    tempFile,
    JSON.stringify({
      projectId: '__to_be_created__',
      serverUrl: resolveServerUrl(config),
      workdir: testProjectDir,
    }),
  )

  console.warn('[Global Setup] Ready for tests')
}

export async function globalTeardown() {
  console.warn('[Global Teardown] Cleaning up...')

  // Clean up temporary directory
  try {
    await rm(testProjectDir, { recursive: true, force: true })
    console.warn(`[Global Teardown] Removed test directory: ${testProjectDir}`)
  } catch (error) {
    console.error('[Global Teardown] Failed to remove test directory:', error)
  }

  console.warn('[Global Teardown] Done')
}
