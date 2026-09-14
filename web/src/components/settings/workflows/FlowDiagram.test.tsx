// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowDiagram } from './FlowDiagram'
import { computeLayout } from './layout'
import type { WorkflowStep } from '../../../lib/workflows-actions'

describe('layout computeLayout with customPositions', () => {
  const steps: WorkflowStep[] = [
    {
      id: 'step-1',
      name: 'Step 1',
      type: 'agent',
      phase: 'build',
      agentId: 'builder',
      transitions: [{ when: { type: 'always' }, goto: 'step-2' }],
    },
    {
      id: 'step-2',
      name: 'Step 2',
      type: 'sub_agent',
      phase: 'verification',
      subAgentType: 'verifier',
      transitions: [{ when: { type: 'always' }, goto: '$done' }],
    },
  ]

  const agentTypes = [
    { id: 'builder', name: 'Builder', description: '', subagent: false, allowedTools: [] },
    { id: 'verifier', name: 'Verifier', description: '', subagent: true, allowedTools: [] },
  ]

  it('computes default positions when no custom positions are passed', () => {
    const layout = computeLayout(steps, 'step-1', 'Always', agentTypes)
    expect(layout.nodes.length).toBe(4) // $start, step-1, step-2, $done
    expect(layout.posMap.has('step-1')).toBe(true)
    expect(layout.posMap.has('step-2')).toBe(true)
  })

  it('uses custom positions when provided', () => {
    const customPositions = {
      'step-1': { cx: 200, cy: 300 },
      'step-2': { cx: 450, cy: 600 },
    }
    const layout = computeLayout(steps, 'step-1', 'Always', agentTypes, customPositions)
    const s1 = layout.posMap.get('step-1')
    const s2 = layout.posMap.get('step-2')
    expect(s1).toEqual({ cx: 200, cy: 300, w: 150, h: 54 })
    expect(s2).toEqual({ cx: 450, cy: 600, w: 150, h: 54 })
  })
})

describe('FlowDiagram controls', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const steps: WorkflowStep[] = [
    {
      id: 'step-1',
      name: 'Step 1',
      type: 'agent',
      phase: 'build',
      agentId: 'builder',
      transitions: [],
    },
  ]

  const agentTypes = [{ id: 'builder', name: 'Builder', description: '', subagent: false, allowedTools: [] }]

  it('renders zoom in, zoom out, reset, and auto-layout controls', () => {
    render(
      <FlowDiagram
        steps={steps}
        entryStep="step-1"
        selectedNodeId={null}
        selectedEdgeKey={null}
        startConditionLabel="Always"
        agentTypes={agentTypes}
        isReadOnly={false}
        onSelectNode={vi.fn()}
        onSelectEdge={vi.fn()}
        onRemoveStep={vi.fn()}
        onCreateTransition={vi.fn()}
        onReconnectTo={vi.fn()}
        onReconnectFrom={vi.fn()}
        onDeleteTransition={vi.fn()}
      />,
    )

    expect(screen.getByTitle('Zoom in')).toBeDefined()
    expect(screen.getByTitle('Zoom out')).toBeDefined()
    expect(screen.getByTitle('Reset zoom (100%)')).toBeDefined()
    expect(screen.getByTitle('Auto-layout')).toBeDefined()
  })

  it('updates zoom level when clicking zoom in and zoom out', () => {
    render(
      <FlowDiagram
        steps={steps}
        entryStep="step-1"
        selectedNodeId={null}
        selectedEdgeKey={null}
        startConditionLabel="Always"
        agentTypes={agentTypes}
        isReadOnly={false}
        onSelectNode={vi.fn()}
        onSelectEdge={vi.fn()}
        onRemoveStep={vi.fn()}
        onCreateTransition={vi.fn()}
        onReconnectTo={vi.fn()}
        onReconnectFrom={vi.fn()}
        onDeleteTransition={vi.fn()}
      />,
    )

    const zoomInBtn = screen.getByTitle('Zoom in')
    const resetBtn = screen.getByTitle('Reset zoom (100%)')

    expect(resetBtn.textContent).toBe('100%')
    fireEvent.click(zoomInBtn)
    expect(resetBtn.textContent).toBe('115%')

    const zoomOutBtn = screen.getByTitle('Zoom out')
    fireEvent.click(zoomOutBtn)
    expect(resetBtn.textContent).toBe('100%')
  })

  it('calls onUpdateStepPosition when dragging a step node', () => {
    const onUpdateStepPosition = vi.fn()
    const { container } = render(
      <FlowDiagram
        steps={steps}
        entryStep="step-1"
        selectedNodeId={null}
        selectedEdgeKey={null}
        startConditionLabel="Always"
        agentTypes={agentTypes}
        isReadOnly={false}
        onUpdateStepPosition={onUpdateStepPosition}
        onSelectNode={vi.fn()}
        onSelectEdge={vi.fn()}
        onRemoveStep={vi.fn()}
        onCreateTransition={vi.fn()}
        onReconnectTo={vi.fn()}
        onReconnectFrom={vi.fn()}
        onDeleteTransition={vi.fn()}
      />,
    )

    const stepNode = screen.getByText('Builder').closest('g')
    const svg = container.querySelector('svg')
    expect(stepNode).toBeDefined()
    expect(svg).toBeDefined()

    if (stepNode && svg) {
      fireEvent.mouseDown(stepNode, { clientX: 100, clientY: 100 })
      fireEvent.mouseMove(svg, { clientX: 150, clientY: 180 })
      fireEvent.mouseUp(svg)

      expect(onUpdateStepPosition).toHaveBeenCalledWith(
        'step-1',
        expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      )
    }
  })
})
