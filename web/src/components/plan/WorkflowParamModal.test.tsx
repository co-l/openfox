// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowParamModal } from './WorkflowParamModal'
import type { WorkflowParameter } from '@shared/types.js'

describe('WorkflowParamModal', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockParameters: WorkflowParameter[] = [
    {
      id: 'feature',
      label: 'Feature Name',
      description: 'The name of the feature',
      type: 'input',
      default: 'Auth feature',
      required: true,
      position: 0,
    },
    {
      id: 'details',
      label: 'Detailed Spec',
      description: 'Long description',
      type: 'textarea',
      default: 'Line 1\nLine 2',
      position: 1,
    },
    {
      id: 'includeTests',
      label: 'Include Tests',
      description: 'Generate tests alongside',
      type: 'checkbox',
      default: true,
      position: 2,
    },
    {
      id: 'environment',
      label: 'Target Environment',
      description: 'Deployment target',
      type: 'select',
      options: ['staging', 'production', 'local'],
      default: 'production',
      position: 3,
    },
  ]

  it('renders all parameter types with their pre-filled default values', () => {
    render(
      <WorkflowParamModal
        workflowName="Deploy Feature"
        parameters={mockParameters}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    // Text Input
    const input = screen.getByPlaceholderText('Feature Name') as HTMLInputElement
    expect(input.value).toBe('Auth feature')

    // Textarea
    const textarea = screen.getByPlaceholderText('Detailed Spec') as HTMLTextAreaElement
    expect(textarea.value).toBe('Line 1\nLine 2')

    // Checkbox
    const checkbox = screen.getByLabelText(/Include Tests/) as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    // Select
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('production')
  })

  it('submits collected values correctly on confirm', () => {
    const onConfirm = vi.fn()
    render(
      <WorkflowParamModal
        workflowName="Deploy Feature"
        parameters={mockParameters}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    const submitBtn = screen.getByRole('button', { name: 'Run workflow' })
    fireEvent.click(submitBtn)

    expect(onConfirm).toHaveBeenCalledWith({
      feature: 'Auth feature',
      details: 'Line 1\nLine 2',
      includeTests: 'true',
      environment: 'production',
    })
  })

  it('toggles checkbox and updates values', () => {
    const onConfirm = vi.fn()
    render(
      <WorkflowParamModal
        workflowName="Deploy Feature"
        parameters={mockParameters}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    const checkbox = screen.getByLabelText(/Include Tests/) as HTMLInputElement
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(false)

    const submitBtn = screen.getByRole('button', { name: 'Run workflow' })
    fireEvent.click(submitBtn)

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        includeTests: 'false',
      }),
    )
  })
})
