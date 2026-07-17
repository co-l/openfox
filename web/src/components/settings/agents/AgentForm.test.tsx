/* @vitest-environment happy-dom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentForm, type AgentFormProps } from './AgentForm'

function props(overrides: Partial<AgentFormProps> = {}): AgentFormProps {
  return {
    formName: 'Planner',
    formId: 'planner',
    formDescription: '',
    formSubagent: false,
    formTools: [],
    formColor: '#000000',
    formPrompt: 'Prompt',
    formError: '',
    saving: false,
    isReadOnly: false,
    availableTools: [],
    providers: [
      {
        id: 'p',
        name: 'Provider',
        url: '',
        backend: 'vllm',
        apiKey: undefined,
        models: [{ id: 'm', contextWindow: 1000, source: 'user' }],
        isActive: true,
        createdAt: '',
      },
    ],
    modelCascade: [{ providerId: 'p', model: 'm' }],
    onModelCascadeChange: vi.fn(),
    onNameChange: vi.fn(),
    onIdChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onSubagentChange: vi.fn(),
    onToolsChange: vi.fn(),
    onColorChange: vi.fn(),
    onPromptChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    onDuplicate: vi.fn(),
    ...overrides,
  }
}

describe('AgentForm cascade', () => {
  it('disables a saved cascade by requesting inheritance', () => {
    const onModelCascadeChange = vi.fn()
    render(<AgentForm {...props({ onModelCascadeChange })} />)
    fireEvent.click(screen.getByText('Use session model'))
    expect(onModelCascadeChange).toHaveBeenCalledWith(undefined)
  })
})
