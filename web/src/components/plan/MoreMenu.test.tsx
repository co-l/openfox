// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRevalidateWorkflows, mockWorkflowsModalProps } = vi.hoisted(() => ({
  mockRevalidateWorkflows: vi.fn(async () => undefined),
  mockWorkflowsModalProps: [] as Array<{ isOpen?: boolean; initialEditId?: string | null; projectDir?: string }>,
}))

vi.mock('../../hooks/useT', () => ({
  useT: () => (strings: { en: string }) => strings.en,
}))

vi.mock('../../stores/session', () => ({
  useSessionStore: (selector: (state: { currentSession: { workdir: string } }) => unknown) =>
    selector({ currentSession: { workdir: '/repo/a' } }),
}))

vi.mock('../../hooks/useResource', () => ({
  useResource: () => ({ data: undefined, loading: false, error: undefined, refresh: vi.fn() }),
}))

vi.mock('../../hooks/useWorkflows', () => ({
  useWorkflows: () => ({
    workflows: [{ id: 'wf-1', name: 'WF 1', description: '', version: '1.0.0', scope: 'project' as const }],
    revalidate: mockRevalidateWorkflows,
  }),
}))

vi.mock('../settings/CommandsModal', () => ({ CommandsModal: () => null }))

vi.mock('../settings/WorkflowsModal', () => ({
  WorkflowsModal: (props: { isOpen?: boolean; initialEditId?: string | null; projectDir?: string }) => {
    mockWorkflowsModalProps.push(props)
    return <div data-testid="workflows-modal" data-project-dir={props.projectDir ?? ''} />
  },
}))

import { MoreMenu } from './MoreMenu'

function renderMenu() {
  return render(
    <MoreMenu
      onSendCommand={vi.fn()}
      onSelectWorkflow={vi.fn()}
      onSelectWorkflowWithSubGroup={vi.fn()}
      onOpenCommandsManager={vi.fn()}
      onOpenWorkflowsManager={vi.fn()}
      onAttach={vi.fn()}
    />,
  )
}

describe('MoreMenu workflow editing', () => {
  beforeEach(() => {
    mockRevalidateWorkflows.mockClear()
    mockWorkflowsModalProps.length = 0
  })

  afterEach(() => {
    cleanup()
  })

  it('leaves the workflow list alone while the commands tab is shown', () => {
    renderMenu()

    fireEvent.click(screen.getByTitle('More options'))

    expect(mockRevalidateWorkflows).not.toHaveBeenCalled()
  })

  it('revalidates the workflow list when the workflows tab is shown', () => {
    renderMenu()
    fireEvent.click(screen.getByTitle('More options'))

    fireEvent.click(screen.getByText('Workflows'))

    expect(mockRevalidateWorkflows).toHaveBeenCalledTimes(1)
  })

  it('opens the edit modal scoped to the session workdir so the save refreshes the same cache key', () => {
    renderMenu()
    fireEvent.click(screen.getByTitle('More options'))
    fireEvent.click(screen.getByText('Workflows'))
    fireEvent.click(screen.getByTitle('Edit'))

    const opened = mockWorkflowsModalProps.filter((props) => props.isOpen)
    expect(opened.length).toBeGreaterThan(0)
    expect(opened.at(-1)).toMatchObject({ isOpen: true, initialEditId: 'wf-1', projectDir: '/repo/a' })
  })
})
