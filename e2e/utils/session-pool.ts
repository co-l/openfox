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
import { createProject, createSession, setSessionMode, type Project } from './rest-client.js'

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
  /** HTTP API URL (derived from wsUrl if not provided) */
  apiUrl?: string
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
  const { template = 'empty', mode = 'planner', projectName = 'Test Project', initGit = false, wsUrl, apiUrl } = options

  let client: TestClient | null = null
  let testDir: TestProject | null = null
  let projectId: string | null = null
  let session: Session | null = null
  let restProject: Project | null = null

  return {
    async setup(): Promise<void> {
      // Create client and project once
      client = await createTestClient(wsUrl ? { url: wsUrl } : undefined)
      testDir = await createTestProject({ template, initGit })

      // Derive API URL from WebSocket URL
      const baseUrl =
        apiUrl ??
        (wsUrl
          ? wsUrl.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '')
          : 'http://localhost:3999')

      // Create project and session via REST API
      restProject = await createProject(baseUrl, { name: projectName, workdir: testDir.path })
      projectId = restProject.id

      const restSession = await createSession(baseUrl, { projectId })

      // Load session via WebSocket to subscribe to events
      await client.send('session.load', { sessionId: restSession.id })
      session = client.getSession()!

      if (mode === 'builder') {
        await setSessionMode(baseUrl, restSession.id, 'builder', wsUrl)
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
      restProject = null
    },

    async reset(): Promise<void> {
      if (!client || !projectId) {
        throw new Error('SessionPool not initialized. Call setup() first.')
      }

      // Clear collected events for fresh test
      client.clearEvents()

      // Derive API URL from WebSocket URL
      const baseUrl =
        apiUrl ??
        (wsUrl
          ? wsUrl.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '')
          : 'http://localhost:3999')

      // Create a fresh session for isolation (reuses WebSocket connection)
      const restSession = await createSession(baseUrl, { projectId })

      // Load session via WebSocket to subscribe to events
      await client.send('session.load', { sessionId: restSession.id })
      session = client.getSession()!

      // Restore mode if needed
      if (mode === 'builder') {
        await setSessionMode(baseUrl, restSession.id, 'builder', wsUrl)
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
