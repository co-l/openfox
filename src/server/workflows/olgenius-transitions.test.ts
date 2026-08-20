import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { findMatchingTransition, evaluateCondition } from './executor.js'
import type { WorkflowDefinition, WorkflowStep } from './types.js'
import type { StepOutcome } from './executor.js'
import type { MetadataEntry } from '../../shared/types.js'

const wf = JSON.parse(
  readFileSync(new URL('./__fixtures__/olgenius.workflow.json', import.meta.url), 'utf8'),
) as WorkflowDefinition
const stepById = (id: string): WorkflowStep => {
  const s = wf.steps.find((s) => s.id === id)
  if (!s) throw new Error(`step ${id} not found`)
  return s
}
const completed: StepOutcome = { result: 'completed', output: {} }

/** Build a metadataEntries map from a compact { key: [statuses] } shape. */
const md = (entries: Record<string, string[]>): Record<string, MetadataEntry[]> =>
  Object.fromEntries(
    Object.entries(entries).map(([key, statuses]) => [
      key,
      statuses.map((status, i) => ({ id: String(i), description: '', status })),
    ]),
  )

describe('olgenius — arbitrate routing', () => {
  const transitions = stepById('arbitrate').transitions

  it('borne 2 tours plan/avocat → validate (avant tout, even if REPLAN)', () => {
    const m = md({ plan_rounds: ['2'], arbitration: ['REPLAN'] })
    expect(findMatchingTransition(transitions, completed, m)?.goto).toBe('validate')
  })

  it('arbitration=VALIDATE → validate', () => {
    const m = md({ plan_rounds: ['1'], arbitration: ['VALIDATE'] })
    expect(findMatchingTransition(transitions, completed, m)?.goto).toBe('validate')
  })

  it('arbitration=REPLAN, under borne → plan', () => {
    const m = md({ plan_rounds: ['1'], arbitration: ['REPLAN'] })
    expect(findMatchingTransition(transitions, completed, m)?.goto).toBe('plan')
  })

  it('fallback (no metadata) → validate', () => {
    expect(findMatchingTransition(transitions, completed, md({}))?.goto).toBe('validate')
  })
})

describe('olgenius — verify routing (QA)', () => {
  const transitions = stepById('verify').transitions

  it('qa_verdict=CONFORME → close_phase', () => {
    const m = md({ qa_verdict: ['CONFORME'], dev_qa_rounds: ['0'] })
    expect(findMatchingTransition(transitions, completed, m)?.goto).toBe('close_phase')
  })

  it('dev_qa_rounds=3 → $blocked (borne avant NON CONFORME)', () => {
    const m = md({ qa_verdict: ['NON CONFORME'], dev_qa_rounds: ['3'] })
    expect(findMatchingTransition(transitions, completed, m)?.goto).toBe('$blocked')
  })

  it('qa_verdict=NON CONFORME, under borne → develop', () => {
    const m = md({ qa_verdict: ['NON CONFORME'], dev_qa_rounds: ['1'] })
    expect(findMatchingTransition(transitions, completed, m)?.goto).toBe('develop')
  })

  it('qa_verdict=PENDING init → develop (fallback always)', () => {
    const m = md({ qa_verdict: ['PENDING'], dev_qa_rounds: ['0'] })
    expect(findMatchingTransition(transitions, completed, m)?.goto).toBe('develop')
  })
})

describe('olgenius — next_phase routing', () => {
  const transitions = stepById('next_phase').transitions

  it('phase_loop=DONE → close', () => {
    expect(findMatchingTransition(transitions, completed, md({ phase_loop: ['DONE'] }))?.goto).toBe('close')
  })

  it('phase_loop=NEXT → open_phase', () => {
    expect(findMatchingTransition(transitions, completed, md({ phase_loop: ['NEXT'] }))?.goto).toBe('open_phase')
  })

  it('fallback (no metadata) → close', () => {
    expect(findMatchingTransition(transitions, completed, md({}))?.goto).toBe('close')
  })
})

describe('olgenius — validate (user step)', () => {
  const transitions = stepById('validate').transitions

  it('step_result "Valider" → open_phase', () => {
    const outcome: StepOutcome = { result: 'Valider', output: {} }
    expect(findMatchingTransition(transitions, outcome, md({}))?.goto).toBe('open_phase')
  })

  it('step_result "Amender" → plan', () => {
    const outcome: StepOutcome = { result: 'Amender', output: {} }
    expect(findMatchingTransition(transitions, outcome, md({}))?.goto).toBe('plan')
  })

  it('step_result "Rejeter" → close', () => {
    const outcome: StepOutcome = { result: 'Rejeter', output: {} }
    expect(findMatchingTransition(transitions, outcome, md({}))?.goto).toBe('close')
  })

  it('evaluateCondition step_result matches exact result only', () => {
    const when = transitions[0]!.when
    expect(evaluateCondition(when, { result: 'Valider', output: {} }, md({}))).toBe(true)
    expect(evaluateCondition(when, { result: 'Amender', output: {} }, md({}))).toBe(false)
  })
})

describe('olgenius — invariant: agent steps never use step_result', () => {
  it('no agent step has a step_result transition (impossible to fire after agent)', () => {
    const offenders: string[] = []
    for (const step of wf.steps) {
      if (step.type !== 'agent') continue
      for (const t of step.transitions) {
        if (t.when.type === 'step_result') offenders.push(`${step.id}.${t.goto}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
