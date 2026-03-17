import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Criterion } from '../../shared/types.js'
import type { ServerMessage } from '../../shared/protocol.js'

// We'll test the orchestrator logic by mocking the session manager and workers
// This tests the coordination logic, not the actual LLM calls

describe('runOrchestrator', () => {
  // These tests will be integration tests once the workers are extracted
  // For now, we're testing the decision → action flow
  
  it.todo('calls runBuilderStep when decision is RUN_BUILDER')
  it.todo('calls runVerifierStep when decision is RUN_VERIFIER')
  it.todo('stops and returns when decision is DONE')
  it.todo('stops and sets phase to blocked when decision is BLOCKED')
  it.todo('injects nudge message between builder iterations')
  it.todo('respects abort signal')
  it.todo('limits iterations to maxIterations')
})
