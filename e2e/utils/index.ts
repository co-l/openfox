/**
 * E2E test utilities
 */

export { createTestClient, type TestClient, type ChatResponse } from './ws-client.js'
export { createTestProject, createTestProjects, cleanupProjects, type TestProject } from './project-factory.js'
export { createSessionPool, type SessionPool, type SessionPoolContext, type SessionPoolOptions } from './session-pool.js'
export { createTestServer, type TestServerHandle } from './server-factory.js'
export {
  createCollectedEvents,
  collectUntil,
  collectChatEvents,
  collectUntilPhase,
  assertEventTypes,
  assertNoErrors,
  type CollectedEvents,
} from './event-collector.js'
