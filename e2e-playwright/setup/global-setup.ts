import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let testProjectDir: string
let testProjectId: string

export default async function globalSetup() {
  console.log('[Global Setup] Creating test project...')
  
  // Set environment variables for in-memory database and mock LLM
  process.env['OPENFOX_DB_PATH'] = ':memory:'
  process.env['OPENFOX_MOCK_LLM'] = 'true'
  process.env['OPENFOX_LOG_LEVEL'] = 'error'
  
  // Create temporary directory for test project
  testProjectDir = join(tmpdir(), `openfox-test-${Date.now()}`)
  await mkdir(testProjectDir, { recursive: true })
  
  // Create minimal README.md
  await writeFile(join(testProjectDir, 'README.md'), '# Test Project\n\nThis is a test project for Playwright E2E tests.\n')
  
  // Create test project via REST API (server already running via webServer config)
  const url = 'http://localhost:10669'
  const projectResponse = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Playwright Test Project',
      workdir: testProjectDir,
    }),
  })
  
  if (!projectResponse.ok) {
    throw new Error('Failed to create test project')
  }
  
  const projectData = await projectResponse.json()
  testProjectId = projectData.project.id
  console.log(`[Global Setup] Test project created: ${testProjectId}`)
  
  // Write project ID to a temp file for tests to read
  const tempFile = join(tmpdir(), 'openfox-test-project-id.json')
  await writeFile(tempFile, JSON.stringify({
    projectId: testProjectId,
    serverUrl: url,
  }))
  
  console.log('[Global Setup] Ready for tests')
}

export async function globalTeardown() {
  console.log('[Global Teardown] Cleaning up...')
  
  // Clean up temporary directory
  try {
    await rm(testProjectDir, { recursive: true, force: true })
    console.log(`[Global Teardown] Removed test directory: ${testProjectDir}`)
  } catch (error) {
    console.error('[Global Teardown] Failed to remove test directory', error)
  }
  
  console.log('[Global Teardown] Done')
}
