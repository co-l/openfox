import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { userStepChoices } from './executor.js'
import type { WorkflowDefinition, WorkflowStep, UserStep } from './types.js'

const wf = JSON.parse(
  readFileSync(new URL('./__fixtures__/olgenius.workflow.json', import.meta.url), 'utf8'),
) as WorkflowDefinition
const stepById = (id: string): WorkflowStep => {
  const s = wf.steps.find((s) => s.id === id)
  if (!s) throw new Error(`step ${id} not found`)
  return s
}
const isAgent = (s: WorkflowStep): boolean => (s as { type: string }).type === 'agent'

describe('olgenius workflow — structure', () => {
  it('metadata id/name + entryStep + maxIterations', () => {
    expect(wf.metadata.id).toBe('olgenius')
    expect(wf.metadata.name).toBeTruthy()
    expect(wf.entryStep).toBe('cadrage')
    expect(wf.settings.maxIterations).toBe(80)
  })

  it('has exactly 11 steps', () => {
    expect(wf.steps.length).toBe(11)
  })

  it('all step ids are unique', () => {
    const ids = wf.steps.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every step has at least one transition ending at a real target or terminal', () => {
    const ids = new Set(wf.steps.map((s) => s.id))
    const terminals = new Set(['$done', '$blocked'])
    for (const step of wf.steps) {
      expect(step.transitions.length).toBeGreaterThan(0)
      for (const t of step.transitions) {
        expect(terminals.has(t.goto) || ids.has(t.goto)).toBe(true)
      }
    }
  })

  it('validate is a user step with exactly 3 ordered choices', () => {
    const v = stepById('validate')
    expect((v as { type: string }).type).toBe('user')
    const choices = userStepChoices(v as UserStep).map((c) => c.id)
    expect(choices).toEqual(['Valider', 'Amender', 'Rejeter'])
  })

  it('all agent steps reference one of the 5 olgenius agents', () => {
    const validAgents = new Set(['orchestrator', 'planificateur', 'avocat-du-diable', 'dev-tdd', 'qa'])
    for (const step of wf.steps) {
      if (!isAgent(step)) continue
      const agentId = (step as { agentId?: string }).agentId
      expect(agentId, `step ${step.id} missing agentId`).toBeTruthy()
      expect(validAgents.has(agentId!)).toBe(true)
    }
  })

  it('every agent step has a non-empty prompt', () => {
    for (const step of wf.steps) {
      if (!isAgent(step)) continue
      expect((step as { prompt?: string }).prompt, `step ${step.id} missing prompt`).toBeTruthy()
    }
  })

  it('close step terminates at $done', () => {
    const close = stepById('close')
    expect(close.transitions.some((t) => t.goto === '$done')).toBe(true)
  })

  it('verify step can reach $blocked (QA borne)', () => {
    const verify = stepById('verify')
    expect(verify.transitions.some((t) => t.goto === '$blocked')).toBe(true)
  })

  it('entry chain is reachable: cadrage → plan → contradict → arbitrate → validate', () => {
    const goto = (id: string): string[] => stepById(id).transitions.map((t) => t.goto)
    expect(goto('cadrage')).toContain('plan')
    expect(goto('plan')).toContain('contradict')
    expect(goto('contradict')).toContain('arbitrate')
    expect(goto('arbitrate')).toContain('validate')
  })

  it('execution loop: validate → open_phase → develop → verify → close_phase → next_phase', () => {
    const goto = (id: string): string[] => stepById(id).transitions.map((t) => t.goto)
    expect(goto('validate')).toContain('open_phase')
    expect(goto('open_phase')).toContain('develop')
    expect(goto('develop')).toContain('verify')
    expect(goto('verify')).toContain('close_phase')
    expect(goto('close_phase')).toContain('next_phase')
  })
})
