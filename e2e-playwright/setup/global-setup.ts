import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let testProjectDir: string

export default async function globalSetup() {
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
      serverUrl: process.env['OPENFOX_E2E_SERVER_URL'] ?? 'http://localhost:10669',
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
    console.error('[Global Teardown] Failed to remove test directory', error)
  }

  console.warn('[Global Teardown] Done')
}
