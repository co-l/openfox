import { test as base } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TestFixtures {
  projectId: string
  serverUrl: string
}

export const test = base.extend<TestFixtures>({
  projectId: async ({}, use) => {
    // Read project ID from temp file created by global setup
    const tempFile = join(tmpdir(), 'openfox-test-project-id.json')
    try {
      const content = await readFile(tempFile, 'utf-8')
      const data = JSON.parse(content)
      await use(data.projectId)
    } catch (error) {
      throw new Error(`Failed to read test project ID. Did global setup run? ${error}`)
    }
  },
  serverUrl: async ({}, use) => {
    // Read server URL from temp file created by global setup
    const tempFile = join(tmpdir(), 'openfox-test-project-id.json')
    try {
      const content = await readFile(tempFile, 'utf-8')
      const data = JSON.parse(content)
      await use(data.serverUrl)
    } catch (error) {
      throw new Error(`Failed to read server URL. Did global setup run? ${error}`)
    }
  },
})

export { expect } from '@playwright/test'

// Re-export page objects for convenience
export { SessionSidebar } from './page-objects/SessionSidebar.js'
export { SessionHeader } from './page-objects/SessionHeader.js'
