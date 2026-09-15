// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StepPanel } from './StepPanel'
import type { WorkflowStep, TemplateVariable } from '../../../lib/workflows-actions'
import type { AgentInfo } from '../../../lib/agents-actions'

const agentTypes: AgentInfo[] = [
  { id: 'builder', name: 'Builder', description: '', subagent: false, allowedTools: [] },
  { id: 'verifier', name: 'Verifier', description: '', subagent: true, allowedTools: [] },
  { id: 'code_reviewer', name: 'Code Reviewer', description: '', subagent: true, allowedTools: [] },
]

const templateVariables: TemplateVariable[] = [{ name: 'workdir', description: 'Working directory' }]

function makeStep(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id: 'reviews',
    name: 'Parallel Reviews',
    type: 'parallel',
    phase: 'verification',
    transitions: [],
    children: [
      { id: 'lint', type: 'shell', command: 'npm run lint' },
      { id: 'review', type: 'sub_agent', subAgentType: 'code_reviewer', prompt: 'Review {{workdir}}' },
    ],
    ...overrides,
  }
}

function renderPanel(step: WorkflowStep, onUpdate = vi.fn()) {
  const view = render(
    <StepPanel
      step={step}
      isEntry={false}
      agentTypes={agentTypes}
      transitionCount={0}
      templateVariables={templateVariables}
      onUpdate={onUpdate}
      onRemove={vi.fn()}
      onSetEntry={vi.fn()}
    />,
  )
  return { ...view, onUpdate }
}

describe('StepPanel parallel step', () => {
  afterEach(cleanup)

  it('lists the children with their ids and the max-concurrency input', () => {
    renderPanel(makeStep())
    expect(screen.getByDisplayValue('lint')).toBeInTheDocument()
    expect(screen.getByDisplayValue('review')).toBeInTheDocument()
    expect(screen.getByText('Max concurrency')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add child step' })).toBeInTheDocument()
  })

  it('adds a child with an auto-generated id', () => {
    const { onUpdate } = renderPanel(makeStep())
    fireEvent.click(screen.getByRole('button', { name: 'Add child step' }))
    const next = onUpdate.mock.calls.at(-1)![0] as WorkflowStep
    expect(next.children).toHaveLength(3)
    expect(next.children?.[2]).toMatchObject({ id: 'child-1', type: 'shell' })
    expect(next.children?.[0]?.id).toBe('lint')
  })

  it('skips taken ids when auto-generating', () => {
    const { onUpdate } = renderPanel(makeStep({ children: [{ id: 'child-1', type: 'shell', command: 'x' }] }))
    fireEvent.click(screen.getByRole('button', { name: 'Add child step' }))
    const next = onUpdate.mock.calls.at(-1)![0] as WorkflowStep
    expect(next.children?.[1]?.id).toBe('child-2')
  })

  it('removes a child row without touching the others', () => {
    const { onUpdate } = renderPanel(makeStep())
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    // First Delete is the step header; the child rows follow
    fireEvent.click(deleteButtons[1]!)
    const next = onUpdate.mock.calls.at(-1)![0] as WorkflowStep
    expect(next.children).toHaveLength(1)
    expect(next.children?.[0]?.id).toBe('review')
  })

  it('updates a child type in place', () => {
    const { onUpdate } = renderPanel(makeStep())
    const childTypeSelects = (screen.getAllByRole('combobox') as HTMLSelectElement[]).filter(
      (el) => el.value === 'shell',
    )
    fireEvent.change(childTypeSelects[0]!, { target: { value: 'sub_agent' } })
    const next = onUpdate.mock.calls.at(-1)![0] as WorkflowStep
    expect(next.children?.[0]).toMatchObject({ id: 'lint', type: 'sub_agent' })
    expect(next.children?.[1]?.type).toBe('sub_agent')
  })

  it('auto-suffixes a child id that collides with a sibling on rename', () => {
    const { onUpdate } = renderPanel(makeStep())
    const idInputs = screen.getAllByRole('textbox', { name: 'Child ID' })
    fireEvent.change(idInputs[0]!, { target: { value: 'review' } })
    const next = onUpdate.mock.calls.at(-1)![0] as WorkflowStep
    expect(next.children?.[0]?.id).toBe('review-2')
    expect(next.children?.[1]?.id).toBe('review')
  })

  it('slugifies a child id with spaces and special characters on rename', () => {
    const { onUpdate } = renderPanel(makeStep())
    const idInputs = screen.getAllByRole('textbox', { name: 'Child ID' })
    fireEvent.change(idInputs[0]!, { target: { value: 'My Child!' } })
    const next = onUpdate.mock.calls.at(-1)![0] as WorkflowStep
    expect(next.children?.[0]?.id).toBe('my-child')
  })

  it("strips the previous type's fields when a child type switches", () => {
    const { onUpdate } = renderPanel(makeStep())
    const subAgentSelect = (screen.getAllByRole('combobox') as HTMLSelectElement[]).find(
      (el) => el.value === 'sub_agent',
    )!
    fireEvent.change(subAgentSelect, { target: { value: 'shell' } })
    const next = onUpdate.mock.calls.at(-1)![0] as WorkflowStep
    expect(next.children?.[1]).toMatchObject({ id: 'review', type: 'shell', command: '' })
    expect(next.children?.[1]).not.toHaveProperty('subAgentType')
    expect(next.children?.[1]).not.toHaveProperty('prompt')
  })

  it('strips parallel fields when the step type switches away from parallel', () => {
    const { onUpdate } = renderPanel(makeStep({ maxConcurrency: 2 }))
    const typeSelect = (screen.getAllByRole('combobox') as HTMLSelectElement[]).find((el) => el.value === 'parallel')!
    fireEvent.change(typeSelect, { target: { value: 'shell' } })
    const next = onUpdate.mock.calls.at(-1)![0] as WorkflowStep
    expect(next.type).toBe('shell')
    expect(next).not.toHaveProperty('children')
    expect(next).not.toHaveProperty('maxConcurrency')
  })

  it('strips other step-type fields when switching the step type to parallel', () => {
    const agentStep: WorkflowStep = {
      id: 's',
      name: 'Agent Step',
      type: 'agent',
      phase: 'build',
      agentId: 'builder',
      transitions: [],
    }
    const { onUpdate } = renderPanel(agentStep)
    const typeSelect = (screen.getAllByRole('combobox') as HTMLSelectElement[]).find((el) => el.value === 'agent')!
    fireEvent.change(typeSelect, { target: { value: 'parallel' } })
    const next = onUpdate.mock.calls.at(-1)![0] as WorkflowStep
    expect(next.type).toBe('parallel')
    expect(next).not.toHaveProperty('agentId')
    expect(next).not.toHaveProperty('subAgentType')
    expect(next).not.toHaveProperty('prompt')
    expect(next).not.toHaveProperty('command')
  })

  it('defaults to an empty children list when switching the step type to parallel', () => {
    const agentStep: WorkflowStep = {
      id: 's',
      name: 'Agent Step',
      type: 'agent',
      phase: 'build',
      agentId: 'builder',
      transitions: [],
    }
    const { onUpdate } = renderPanel(agentStep)
    const typeSelect = (screen.getAllByRole('combobox') as HTMLSelectElement[]).find((el) => el.value === 'agent')!
    fireEvent.change(typeSelect, { target: { value: 'parallel' } })
    const next = onUpdate.mock.calls.at(-1)![0] as WorkflowStep
    expect(next.type).toBe('parallel')
    expect(next.children).toEqual([])
  })
})
