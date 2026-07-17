/* @vitest-environment happy-dom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentGroup } from './AgentListItem'

const agent = { id: 'planner', name: 'Planner', description: '', subagent: false, allowedTools: [] }

describe('AgentGroup built-in actions', () => {
  it('never exposes edit for built-in agents', () => {
    render(
      <AgentGroup
        title="Built-in"
        agents={[agent]}
        subagents={[]}
        isBuiltIn
        onView={vi.fn()}
        onDuplicate={vi.fn()}
        onEdit={vi.fn()}
      />,
    )

    expect(screen.queryByTitle('Edit')).toBeNull()
    expect(screen.getByTitle('View')).toBeTruthy()
    expect(screen.getByTitle('Duplicate')).toBeTruthy()
  })

  it('hides reset for pristine defaults and confirms overridden resets', () => {
    const onDelete = vi.fn()
    const { rerender } = render(
      <AgentGroup
        title="Built-in"
        agents={[agent]}
        subagents={[]}
        isBuiltIn
        onView={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={onDelete}
        canDelete={() => false}
      />,
    )
    expect(screen.queryByTitle('Delete')).toBeNull()

    rerender(
      <AgentGroup
        title="Built-in"
        agents={[agent]}
        subagents={[]}
        isBuiltIn
        onView={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={onDelete}
        canDelete={() => true}
      />,
    )
    fireEvent.click(screen.getByTitle('Delete'))
    expect(screen.getByText('Reset')).toBeTruthy()
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByText('Reset')).toBeNull()
    fireEvent.click(screen.getByTitle('Delete'))
    fireEvent.click(screen.getByText('Reset'))
    expect(onDelete).toHaveBeenCalledWith('planner')
  })
})
