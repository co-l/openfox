// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { FlowDiagram } from './FlowDiagram'
import { resolveStepRuntime } from './layout'
import type { WorkflowStep } from '../../../lib/workflows-actions'

const steps: WorkflowStep[] = [
  {
    id: 'build',
    name: 'Builder',
    type: 'agent',
    phase: 'build',
    transitions: [{ when: { type: 'always' }, goto: 'verify' }],
  },
  {
    id: 'verify',
    name: 'Verifier',
    type: 'sub_agent',
    phase: 'verification',
    transitions: [{ when: { type: 'always' }, goto: '$done' }],
  },
]

function renderDiagram(runtime?: Parameters<typeof FlowDiagram>[0]['runtime']) {
  return render(
    <FlowDiagram
      steps={steps}
      entryStep="build"
      selectedNodeId={null}
      selectedEdgeKey={null}
      startConditionLabel=""
      agentTypes={[]}
      isReadOnly={true}
      onSelectNode={() => {}}
      onSelectEdge={() => {}}
      onRemoveStep={() => {}}
      onCreateTransition={() => {}}
      onReconnectTo={() => {}}
      onReconnectFrom={() => {}}
      onDeleteTransition={() => {}}
      {...(runtime ? { runtime } : {})}
    />,
  )
}

describe('FlowDiagram — read-only runtime rendering', () => {
  it('highlights exactly the current step', () => {
    const { container, unmount } = renderDiagram({ currentStepId: 'verify' })
    const current = container.querySelectorAll('[data-testid="flow-step-current"]')
    expect(current.length).toBe(1)
    expect(current[0]?.getAttribute('data-step-id')).toBe('verify')
    unmount()
  })

  it('highlights no step when no current step is known', () => {
    const { container, unmount } = renderDiagram({ currentStepId: null })
    expect(container.querySelectorAll('[data-testid="flow-step-current"]').length).toBe(0)
    unmount()
  })

  it('renders no runtime state at all when no runtime facts are given', () => {
    const { container, unmount } = renderDiagram()
    expect(container.querySelectorAll('[data-testid="flow-step-current"]').length).toBe(0)
    unmount()
  })

  it('shows the exact engine visit count when the engine reported one', () => {
    const { container, unmount } = renderDiagram({
      currentStepId: 'build',
      stepIterationCounts: { build: 3, verify: 1 },
    })
    expect(container.textContent).toContain('x3')
    unmount()
  })

  it('shows no visit badge when the engine reported no count for the step', () => {
    const { container, unmount } = renderDiagram({
      currentStepId: 'build',
      stepIterationCounts: { build: 1, verify: 1 },
    })
    expect(container.textContent).not.toContain('x2')
    unmount()
  })
})

describe('resolveStepRuntime', () => {
  it('reports nothing when no runtime facts are known', () => {
    expect(resolveStepRuntime(undefined, 'build')).toEqual({ isCurrent: false, isPending: false })
  })

  it('marks the current step as current', () => {
    const runtime = resolveStepRuntime({ currentStepId: 'build' }, 'build')
    expect(runtime.isCurrent).toBe(true)
    expect(runtime.isPending).toBe(false)
  })

  it('marks a step as pending only when the engine count map is known and omits it', () => {
    const counts = { build: 2 }
    expect(resolveStepRuntime({ currentStepId: 'build', stepIterationCounts: counts }, 'verify').isPending).toBe(true)
    expect(resolveStepRuntime({ currentStepId: 'build', stepIterationCounts: counts }, 'build').isPending).toBe(false)
  })

  it('never marks a step pending when the count map is unknown', () => {
    expect(resolveStepRuntime({ currentStepId: 'build' }, 'verify').isPending).toBe(false)
  })

  it('reports the exact visit count when known', () => {
    expect(resolveStepRuntime({ stepIterationCounts: { build: 4 } }, 'build').visitCount).toBe(4)
    expect(resolveStepRuntime({ stepIterationCounts: { build: 4 } }, 'verify').visitCount).toBeUndefined()
  })
})
