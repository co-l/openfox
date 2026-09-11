// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StepPanel } from './StepPanel'
import type { WorkflowStep } from '../../../lib/workflows-actions'
import type { Provider } from '../../../stores/config'

describe('StepPanel', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockAgentStep: WorkflowStep = {
    id: 's1',
    name: 'Implement',
    type: 'agent',
    phase: 'build',
    agentId: 'builder',
    transitions: [],
  }

  const mockSubAgentStep: WorkflowStep = {
    id: 's2',
    name: 'Verifier',
    type: 'sub_agent',
    phase: 'verification',
    subAgentType: 'verifier',
    transitions: [],
  }

  const mockProviders: Provider[] = [
    {
      id: 'openai',
      name: 'OpenAI',
      backend: 'openai',
      url: 'https://api.openai.com/v1',
      isActive: true,
      createdAt: '2025-01-01',
      models: [{ id: 'gpt-4o', contextWindow: 128000, source: 'default' }],
    },
  ]

  it('renders model override picker for agent step', () => {
    render(
      <StepPanel
        step={mockAgentStep}
        isEntry={true}
        agentTypes={[{ id: 'builder', name: 'Builder', description: '', subagent: false, allowedTools: [] }]}
        providers={mockProviders}
        transitionCount={0}
        templateVariables={[]}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onSetEntry={vi.fn()}
      />,
    )

    expect(screen.getByText('Model override')).toBeDefined()
  })

  it('renders model override picker for sub_agent step', () => {
    render(
      <StepPanel
        step={mockSubAgentStep}
        isEntry={false}
        agentTypes={[{ id: 'verifier', name: 'Verifier', description: '', subagent: true, allowedTools: [] }]}
        providers={mockProviders}
        transitionCount={0}
        templateVariables={[]}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onSetEntry={vi.fn()}
      />,
    )

    expect(screen.getByText('Model override')).toBeDefined()
  })
})
