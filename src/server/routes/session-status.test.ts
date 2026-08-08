// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { projectSessionStatus, SESSION_STATUS_SCHEMA_VERSION, type SessionStatus } from './session-status.js'
import type { Session } from '../../shared/types.js'

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    projectId: 'proj-1',
    workdir: '/tmp/test',
    mode: 'builder',
    phase: 'plan',
    isRunning: false,
    providerId: null,
    providerModel: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    messages: [],
    criteria: [],
    contextWindows: [],
    executionState: null,
    metadata: { title: 'Test', totalTokensUsed: 0, totalToolCalls: 0, iterationCount: 0 },
    metadataEntries: {},
    ...overrides,
  }
}

describe('projectSessionStatus', () => {
  it('returns schemaVersion 1', () => {
    const status = projectSessionStatus({
      session: buildSession(),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.schemaVersion).toBe(SESSION_STATUS_SCHEMA_VERSION)
    expect(status.schemaVersion).toBe(1)
  })

  it('returns state "waiting" when phase is "waiting"', () => {
    const status = projectSessionStatus({
      session: buildSession({ phase: 'waiting' }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.state).toBe('waiting')
    expect(status.waitingForUser).toBe(false)
  })

  it('returns state "waiting" when there are pending questions', () => {
    const status = projectSessionStatus({
      session: buildSession({ phase: 'build' }),
      pendingQuestionsCount: 2,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.state).toBe('waiting')
    expect(status.waitingForUser).toBe(true)
  })

  it('returns state "waiting" when there are pending confirmations', () => {
    const status = projectSessionStatus({
      session: buildSession({ phase: 'build' }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 1,
      activeWorkflowStepName: null,
    })
    expect(status.state).toBe('waiting')
    expect(status.waitingForUser).toBe(true)
  })

  it('prioritizes "waiting" over "blocked"', () => {
    const status = projectSessionStatus({
      session: buildSession({ phase: 'blocked' }),
      pendingQuestionsCount: 1,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.state).toBe('waiting')
  })

  it('returns state "blocked" when phase is "blocked" with no pending input', () => {
    const status = projectSessionStatus({
      session: buildSession({ phase: 'blocked' }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.state).toBe('blocked')
  })

  it('prioritizes "blocked" over "completed"', () => {
    const status = projectSessionStatus({
      session: buildSession({ phase: 'blocked', isRunning: false }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.state).toBe('blocked')
  })

  it('returns state "completed" when phase is "done" and not running', () => {
    const status = projectSessionStatus({
      session: buildSession({ phase: 'done', isRunning: false }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.state).toBe('completed')
  })

  it('does not return "completed" when phase is "done" but session is still running', () => {
    const status = projectSessionStatus({
      session: buildSession({ phase: 'done', isRunning: true }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.state).toBe('running')
  })

  it('prioritizes "completed" over "running"', () => {
    const status = projectSessionStatus({
      session: buildSession({ phase: 'done', isRunning: false }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.state).toBe('completed')
  })

  it('returns state "running" when isRunning is true', () => {
    const status = projectSessionStatus({
      session: buildSession({ phase: 'build', isRunning: true }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.state).toBe('running')
  })

  it('returns state null when no factually evident state matches', () => {
    const status = projectSessionStatus({
      session: buildSession({ phase: 'plan', isRunning: false }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.state).toBeNull()
  })

  it('passes through the phase as-is', () => {
    const status = projectSessionStatus({
      session: buildSession({ phase: 'verification' }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.phase).toBe('verification')
  })

  it('exposes workflowStep from active execution', () => {
    const status = projectSessionStatus({
      session: buildSession(),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: 'Build feature',
    })
    expect(status.workflowStep).toBe('Build feature')
  })

  it('exposes workflowStep as null when no active execution', () => {
    const status = projectSessionStatus({
      session: buildSession(),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.workflowStep).toBeNull()
  })

  it('uses session.updatedAt as lastActivityAt', () => {
    const status = projectSessionStatus({
      session: buildSession({ updatedAt: '2024-06-15T12:34:56.000Z' }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.lastActivityAt).toBe('2024-06-15T12:34:56.000Z')
  })

  it('exposes a deep link to the UI', () => {
    const status = projectSessionStatus({
      session: buildSession({ id: 'session/with-special id' }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.links.ui).toBe('/?sessionId=session%2Fwith-special%20id')
  })

  it('exposes sessionId from the session', () => {
    const status = projectSessionStatus({
      session: buildSession({ id: 'abc-123' }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(status.sessionId).toBe('abc-123')
  })

  it('returns deterministic output for the same inputs (pure/idempotent)', () => {
    const inputs = {
      session: buildSession({ phase: 'build' as const, isRunning: true }),
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: 'Step 1',
    }
    const a = projectSessionStatus(inputs)
    const b = projectSessionStatus(inputs)
    expect(a).toEqual(b)
  })

  it('does not mutate the session input', () => {
    const session = buildSession({ phase: 'build', isRunning: true })
    const snapshot = JSON.stringify(session)
    projectSessionStatus({
      session,
      pendingQuestionsCount: 0,
      pendingConfirmationsCount: 0,
      activeWorkflowStepName: null,
    })
    expect(JSON.stringify(session)).toBe(snapshot)
  })
})

describe('SessionStatus JSON contract (snapshot)', () => {
  const cases: Array<{ name: string; build: () => SessionStatus }> = [
    {
      name: 'state=running',
      build: () =>
        projectSessionStatus({
          session: buildSession({ phase: 'build', isRunning: true }),
          pendingQuestionsCount: 0,
          pendingConfirmationsCount: 0,
          activeWorkflowStepName: 'Implement feature',
        }),
    },
    {
      name: 'state=waiting (phase=waiting)',
      build: () =>
        projectSessionStatus({
          session: buildSession({ phase: 'waiting' }),
          pendingQuestionsCount: 0,
          pendingConfirmationsCount: 0,
          activeWorkflowStepName: null,
        }),
    },
    {
      name: 'state=waiting (pendingQuestions)',
      build: () =>
        projectSessionStatus({
          session: buildSession({ phase: 'build' }),
          pendingQuestionsCount: 1,
          pendingConfirmationsCount: 0,
          activeWorkflowStepName: null,
        }),
    },
    {
      name: 'state=blocked',
      build: () =>
        projectSessionStatus({
          session: buildSession({ phase: 'blocked' }),
          pendingQuestionsCount: 0,
          pendingConfirmationsCount: 0,
          activeWorkflowStepName: null,
        }),
    },
    {
      name: 'state=completed',
      build: () =>
        projectSessionStatus({
          session: buildSession({ phase: 'done', isRunning: false }),
          pendingQuestionsCount: 0,
          pendingConfirmationsCount: 0,
          activeWorkflowStepName: null,
        }),
    },
    {
      name: 'state=null',
      build: () =>
        projectSessionStatus({
          session: buildSession({ phase: 'plan', isRunning: false }),
          pendingQuestionsCount: 0,
          pendingConfirmationsCount: 0,
          activeWorkflowStepName: null,
        }),
    },
  ]

  for (const c of cases) {
    it(`matches snapshot for ${c.name}`, () => {
      expect(c.build()).toMatchSnapshot()
    })
  }
})
