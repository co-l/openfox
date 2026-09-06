// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
import type { ProjectTask } from '@shared/types.js'

const moveTask = vi.fn().mockResolvedValue({ task: {} })
const setWorkflowChoice = vi.fn().mockResolvedValue({})
const clearError = vi.fn()
const navigate = vi.fn()

vi.mock('wouter', () => ({
  useLocation: () => ['/', navigate],
}))

vi.mock('../../stores/tasks', () => ({
  useTasksStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ moveTask, setWorkflowChoice, lastError: 'GATE_BLOCKED: missing field', clearError }),
}))

import { PostPlanLaunchBar } from './PostPlanLaunchBar'
const task: ProjectTask = {
  id: 't1',
  projectId: 'p1',
  prompt: 'Do the thing',
  attachments: [],
  status: 'todo',
  position: 0,
  version: 1,
  sessionIds: ['s1'],
  activeSessionId: 's1',
  planned: true,
  gateValues: [],
  auditTrail: [],
  createdAt: '',
  updatedAt: '',
}

const workflows = [
  { id: 'default', name: 'Autonomous build', scope: 'builtin' as const, color: '#19a923' },
  { id: 'my-flow', name: 'My Flow', scope: 'user' as const },
]

beforeEach(() => {
  moveTask.mockClear()
  setWorkflowChoice.mockClear()
  navigate.mockClear()
})

afterEach(cleanup)

function renderBar(onLaunchWorkflow = vi.fn()) {
  render(
    <PostPlanLaunchBar task={task} projectId="p1" workflows={workflows as never} onLaunchWorkflow={onLaunchWorkflow} />,
  )
  return onLaunchWorkflow
}

describe('PostPlanLaunchBar', () => {
  it('renders the two column-decision buttons and one button per workflow', () => {
    renderBar()
    expect(screen.getByTestId('post-plan-stay-todo')).toBeTruthy()
    expect(screen.getByTestId('post-plan-switch-inprogress')).toBeTruthy()
    expect(screen.getByTestId('post-plan-workflow-default')).toBeTruthy()
    expect(screen.getByTestId('post-plan-workflow-my-flow')).toBeTruthy()
  })

  it('stay in To Do navigates back to the board without moving the task', () => {
    renderBar()
    fireEvent.click(screen.getByTestId('post-plan-stay-todo'))
    expect(moveTask).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/p/p1')
  })

  it('switch to in progress moves the task through the queue/slot pipeline', () => {
    renderBar()
    fireEvent.click(screen.getByTestId('post-plan-switch-inprogress'))
    expect(moveTask).toHaveBeenCalledWith('p1', 't1', 'in_progress')
  })

  it('shows the store error inline when the move is gate-blocked', async () => {
    moveTask.mockResolvedValueOnce(null)
    renderBar()
    fireEvent.click(screen.getByTestId('post-plan-switch-inprogress'))
    await waitFor(() => expect(screen.getByTestId('post-plan-move-error')).toBeTruthy())
    expect(screen.getByTestId('post-plan-move-error').textContent).toContain('GATE_BLOCKED')
  })

  it('stay in To Do demotes an in-progress task back to todo before navigating', async () => {
    render(
      <PostPlanLaunchBar
        task={{ ...task, status: 'in_progress' }}
        projectId="p1"
        workflows={workflows as never}
        onLaunchWorkflow={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('post-plan-stay-todo'))
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith('p1', 't1', 'todo'))
    expect(navigate).toHaveBeenCalledWith('/p/p1')
  })

  it('a workflow pick persists the choice on the task and launches it directly', async () => {
    const onLaunch = renderBar()
    const wrapper = screen.getByTestId('post-plan-workflow-my-flow')
    fireEvent.click(wrapper.querySelector('button')!)
    await waitFor(() => expect(setWorkflowChoice).toHaveBeenCalledWith('p1', 't1', 'my-flow'))
    expect(onLaunch).toHaveBeenCalledWith('my-flow', undefined, undefined, 'user')
  })
})
