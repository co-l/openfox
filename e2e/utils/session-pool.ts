/**
 * Session Pooling for E2E Tests
 * 
 * Reuses WebSocket connections and sessions within a describe block
 * to avoid the overhead of creating new sessions for each test.
 * 
 * Usage:
 * ```typescript
 * const pool = createSessionPool({ template: 'typescript', mode: 'builder' })
 * 
 * describe('My Tests', () => {
 *   beforeAll(pool.setup)
 *   afterAll(pool.cleanup)
 *   beforeEach(pool.reset)
 *   
 *   it('test', async () => {
 *     const { client, testDir } = pool.get()
 *     // use client...
 *   })
 * })
 * ```
 */

import type { TestClient } from './ws-client.js'
import type { TestProject, TestProjectOptions } from './project-factory.js'
import { createTestClient } from './ws-client.js'
import { createTestProject } from './project-factory.js'

// Re-derive the template type from TestProjectOptions
type ProjectTemplate = NonNullable<TestProjectOptions['template']>

// Session type matches what TestClient.getSession() returns
interface Session {
  id: string
  projectId: string
  mode: 'planner' | 'builder'
  [key: string]: unknown
}

export interface SessionPoolOptions {
  /** Project template to use (default: 'empty') */
  template?: ProjectTemplate
  /** Initial mode (default: 'planner') */
  mode?: 'planner' | 'builder'
  /** Project name (default: 'Test Project') */
  projectName?: string
  /** Initialize git repo (default: false) */
  initGit?: boolean
  /** WebSocket URL for the server (required for in-process testing) */
  wsUrl?: string
}

export interface SessionPoolContext {
  client: TestClient
  testDir: TestProject
  session: Session
  projectId: string
}

export interface SessionPool {
  /** Call in beforeAll - creates client, project, and session once */
  setup: () => Promise<void>
  /** Call in afterAll - cleans up resources */
  cleanup: () => Promise<void>
  /** Call in beforeEach - resets session state for isolation */
  reset: () => Promise<void>
  /** Get the pooled context (client, testDir, session) */
  get: () => SessionPoolContext
}

export function createSessionPool(options: SessionPoolOptions = {}): SessionPool {
  const {
    template = 'empty',
    mode = 'planner',
    projectName = 'Test Project',
    initGit = false,
    wsUrl,
  } = options
  
  let client: TestClient | null = null
  let testDir: TestProject | null = null
  let projectId: string | null = null
  let session: Session | null = null
  
  return {
    async setup(): Promise<void> {
      // Create client and project once
      client = await createTestClient(wsUrl ? { url: wsUrl } : undefined)
      testDir = await createTestProject({ template, initGit })
      
      await client.send('project.create', { name: projectName, workdir: testDir.path })
      projectId = client.getProject()!.id
      
      await client.send('session.create', { projectId })
      session = client.getSession()!
      
      if (mode === 'builder') {
        await client.send('mode.switch', { mode: 'builder' })
        session = client.getSession()!
      }
    },
    
    async cleanup(): Promise<void> {
      if (client) {
        await client.close()
        client = null
      }
      if (testDir) {
        await testDir.cleanup()
        testDir = null
      }
      projectId = null
      session = null
    },
    
    async reset(): Promise<void> {
      if (!client || !projectId) {
        throw new Error('SessionPool not initialized. Call setup() first.')
      }
      
      // Clear collected events for fresh test
      client.clearEvents()
      
      // Create a fresh session for isolation (reuses WebSocket connection)
      await client.send('session.create', { projectId })
      session = client.getSession()!
      
      // Restore mode if needed
      if (mode === 'builder') {
        await client.send('mode.switch', { mode: 'builder' })
        session = client.getSession()!
      }
    },
    
    get(): SessionPoolContext {
      if (!client || !testDir || !session || !projectId) {
        throw new Error('SessionPool not initialized. Call setup() first.')
      }
      return { client, testDir, session, projectId }
    },
  }
}
