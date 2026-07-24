// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ToolCallPreparing } from './ToolCallPreparing'

afterEach(cleanup)

describe('ToolCallPreparing remote execution', () => {
  it('shows the remote badge and purple frame for partial SSH arguments', () => {
    const { container } = render(<ToolCallPreparing name="run_command" arguments={'{"command":"ssh host'} />)

    expect(container.textContent).toContain('REMOTE · SSH')
    expect(container.firstElementChild?.className).toContain('border-purple-500')
  })

  it('shows the remote badge for a nested shell command', () => {
    const { container } = render(
      <ToolCallPreparing name="run_command" arguments={JSON.stringify({ command: "bash -lc 'setsid ssh host'" })} />,
    )

    expect(container.textContent).toContain('REMOTE · SSH')
    expect(container.firstElementChild?.className).toContain('border-purple-500')
  })

  it('does not mark local commands as remote', () => {
    const { container } = render(<ToolCallPreparing name="run_command" arguments={'{"command":"echo ssh"'} />)

    expect(container.textContent).not.toContain('REMOTE')
    expect(container.firstElementChild?.className).not.toContain('border-purple-500')
  })
})
