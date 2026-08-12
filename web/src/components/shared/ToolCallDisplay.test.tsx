// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '../../stores/session'
import { SETTINGS_KEYS, useSettingsStore } from '../../stores/settings'
import { SessionScopeProvider } from '../../stores/session/session-scope'
import { ToolCallDisplay } from './ToolCallDisplay'

vi.mock('./RunCommandView', () => ({
  RunCommandView: () => <div data-testid="run-command-view">command output content</div>,
}))

vi.mock('./DiffView', () => ({
  DiffView: () => <div data-testid="diff-view">diff output</div>,
  FilePreview: () => <div data-testid="file-preview">file preview</div>,
  EditContextView: () => <div data-testid="edit-context-view">edit context</div>,
  ReadFileView: () => <div data-testid="read-file-view">read file output</div>,
}))

vi.mock('./DiagnosticsView', () => ({
  DiagnosticsView: () => <div data-testid="diagnostics-view">diagnostics</div>,
}))

vi.mock('./Markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

vi.mock('./ProjectTasksView', () => ({
  ProjectTasksView: ({ action }: { action: string }) => (
    <div data-testid="project-tasks-view">project tasks board ({action})</div>
  ),
}))

vi.mock('./ScrollArea', () => ({
  ScrollArea: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

const pendingConfirmation = {
  callId: 'call-run-1',
  tool: 'run_command',
  paths: ['/tmp/project/script.sh'],
  workdir: '/tmp/project',
  reason: 'dangerous_command' as const,
}

describe('ToolCallDisplay — remote execution', () => {
  beforeEach(() => {
    useSessionStore.setState({ pendingPathConfirmations: [] })
    useSettingsStore.setState({ settings: {} })
  })

  afterEach(cleanup)

  it.each([
    ['ssh host', 'SSH'],
    ['scp file host:/tmp', 'SCP'],
    ['sftp host', 'SFTP'],
    ['mosh host', 'MOSH'],
  ])('frames compact %s calls with purple border', (command) => {
    const { container } = render(
      <ToolCallDisplay tool="run_command" args={{ command }} status="pending" variant="compact" />,
    )

    expect(container.textContent).not.toContain('REMOTE')
    expect(container.firstElementChild?.className).toContain('border-text-thinking')
  })

  it('wraps an associated permission request in the remote frame', () => {
    useSessionStore.setState({ pendingPathConfirmations: [pendingConfirmation] })

    const { container } = render(
      <ToolCallDisplay
        tool="run_command"
        args={{ command: 'ssh host cat /restricted/file' }}
        status="pending"
        variant="expandable"
        callId="call-run-1"
      />,
    )

    expect(container.textContent).toContain('REMOTE · SSH')
    expect(container.textContent).toContain('Allow')
    expect(container.firstElementChild?.className).toContain('border-text-thinking')
  })

  it('does not mark a local command mentioning ssh as remote', () => {
    const { container } = render(
      <ToolCallDisplay tool="run_command" args={{ command: 'echo ssh' }} status="success" variant="expandable" />,
    )

    expect(container.textContent).not.toContain('REMOTE')
    expect(container.firstElementChild?.className).not.toContain('border-text-thinking')
  })
})

describe('ToolCallDisplay — PathConfirmationButtons placement', () => {
  beforeEach(() => {
    useSessionStore.setState({ pendingPathConfirmations: [] })
    useSettingsStore.setState({ settings: {} })
  })

  afterEach(cleanup)

  it('renders PathConfirmationButtons when callId matches a pending confirmation', () => {
    useSessionStore.setState({ pendingPathConfirmations: [pendingConfirmation] })

    const { container } = render(
      <ToolCallDisplay
        tool="run_command"
        args={{ command: 'echo hello' }}
        status="pending"
        variant="expandable"
        callId="call-run-1"
      />,
    )

    expect(container.textContent).toContain('Deny')
    expect(container.textContent).toContain('Allow')
    expect(container.textContent).toContain('Allow Everything')
  })

  it('does not render PathConfirmationButtons when callId has no matching confirmation', () => {
    useSessionStore.setState({ pendingPathConfirmations: [pendingConfirmation] })

    const { container } = render(
      <ToolCallDisplay
        tool="run_command"
        args={{ command: 'echo hello' }}
        status="pending"
        callId="call-non-matching"
      />,
    )

    expect(container.textContent).not.toContain('Deny')
    expect(container.textContent).not.toContain('Allow')
  })

  it('renders PathConfirmationButtons after command output in DOM order', () => {
    useSessionStore.setState({ pendingPathConfirmations: [pendingConfirmation] })

    const { container } = render(
      <ToolCallDisplay
        tool="run_command"
        args={{ command: 'npm install' }}
        status="success"
        result="installed 42 packages"
        variant="expandable"
        callId="call-run-1"
      />,
    )

    const html = container.innerHTML
    const outputPos = html.indexOf('command output content')
    const denyPos = html.indexOf('Deny')
    expect(outputPos).not.toBe(-1)
    expect(denyPos).not.toBe(-1)
    expect(denyPos).toBeGreaterThan(outputPos)
  })

  it('renders PathConfirmationButtons after specialized content for edit_file', () => {
    useSessionStore.setState({ pendingPathConfirmations: [pendingConfirmation] })

    const { container } = render(
      <ToolCallDisplay
        tool="edit_file"
        args={{ path: '/foo/bar.ts', old_string: 'a', new_string: 'b' }}
        status="success"
        variant="expandable"
        editContext={{
          regions: [
            {
              startLine: 1,
              endLine: 5,
              beforeContext: [],
              afterContext: [],
              oldContent: 'a\nb\n',
              newContent: 'c\nd\n',
              edits: [{ startLine: 1, endLine: 2, oldContent: 'a\nb\n', newContent: 'c\nd\n' }],
            },
          ],
        }}
        callId="call-run-1"
      />,
    )

    const html = container.innerHTML
    const editViewPos = html.indexOf('edit context')
    const denyPos = html.indexOf('Deny')
    expect(editViewPos).not.toBe(-1)
    expect(denyPos).not.toBe(-1)
    expect(denyPos).toBeGreaterThan(editViewPos)
  })

  it('renders PathConfirmationButtons after specialized content for write_file', () => {
    useSessionStore.setState({ pendingPathConfirmations: [pendingConfirmation] })

    const { container } = render(
      <ToolCallDisplay
        tool="write_file"
        args={{ path: '/foo/bar.ts', content: 'new content' }}
        status="success"
        variant="expandable"
        callId="call-run-1"
      />,
    )

    const html = container.innerHTML
    const previewPos = html.indexOf('file preview')
    const denyPos = html.indexOf('Deny')
    expect(previewPos).not.toBe(-1)
    expect(denyPos).not.toBe(-1)
    expect(denyPos).toBeGreaterThan(previewPos)
  })

  it('renders PathConfirmationButtons for a non-focused split pane without focusing it', () => {
    useSessionStore.setState({
      focusedSessionId: 's1',
      pendingPathConfirmations: [],
      panes: {
        s2: {
          session: null,
          messages: [],
          hiddenCount: 0,
          currentTodos: [],
          contextState: null,
          subAgentContextStates: {},
          pendingPathConfirmations: [pendingConfirmation],
          pendingQuestions: [],
          visionFallbackByMessage: {},
          queuedMessages: [],
          abortInProgress: false,
          restoredInput: null,
          activeWorkflowExecution: null,
          gitStatus: null,
          error: null,
          llmRetry: null,
        },
      },
    })

    const { container } = render(
      <SessionScopeProvider value="s2">
        <ToolCallDisplay
          tool="run_command"
          args={{ command: 'echo hello' }}
          status="pending"
          variant="expandable"
          callId="call-run-1"
        />
      </SessionScopeProvider>,
    )

    expect(container.textContent).toContain('Deny')
    expect(container.textContent).toContain('Allow')
    expect(container.textContent).toContain('Allow Everything')
  })
})

describe('ToolCallDisplay — project_tasks', () => {
  beforeEach(() => {
    useSessionStore.setState({ pendingPathConfirmations: [] })
    useSettingsStore.setState({ settings: {} })
  })

  afterEach(cleanup)

  it('renders the project tasks view for a successful list', () => {
    const { container } = render(
      <ToolCallDisplay
        tool="project_tasks"
        args={{ action: 'list' }}
        status="success"
        result={'{"gates":[],"tasks":[]}'}
        variant="expandable"
      />,
    )

    expect(container.querySelector('[data-testid="project-tasks-view"]')).not.toBeNull()
    expect(container.textContent).toContain('project tasks board (list)')
  })

  it('does not fall through to the generic result pre for project_tasks', () => {
    const { container } = render(
      <ToolCallDisplay
        tool="project_tasks"
        args={{ action: 'move', taskId: 'tk_02' }}
        status="success"
        result={'{"id":"tk_02","status":"in_progress"}'}
        variant="expandable"
      />,
    )

    expect(container.querySelector('[data-testid="project-tasks-view"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Result:')
  })
})

describe('ToolCallDisplay — default expansion', () => {
  beforeEach(() => {
    useSessionStore.setState({ pendingPathConfirmations: [] })
    useSettingsStore.setState({ settings: {} })
  })

  afterEach(cleanup)

  it('expands large results by default', () => {
    const bigResult = 'x'.repeat(10_000)
    const { container } = render(
      <ToolCallDisplay tool="custom_tool" args={{}} status="success" result={bigResult} variant="expandable" />,
    )

    expect(container.querySelector('pre')?.textContent).toContain(bigResult)
  })

  it('collapses large finished results when collapseLargeToolCalls is enabled', () => {
    useSettingsStore.setState({
      settings: { [SETTINGS_KEYS.DISPLAY_COLLAPSE_LARGE_TOOL_CALLS]: 'true' },
    })
    const bigResult = 'x'.repeat(10_000)
    const { container } = render(
      <ToolCallDisplay tool="custom_tool" args={{}} status="success" result={bigResult} variant="expandable" />,
    )

    expect(container.querySelector('pre')).toBeNull()
  })

  it('expands small results by default', () => {
    const { container } = render(
      <ToolCallDisplay tool="custom_tool" args={{}} status="success" result="small output" variant="expandable" />,
    )

    expect(container.querySelector('pre')?.textContent).toContain('small output')
  })

  it('expands streaming tool calls regardless of accumulated output size', () => {
    const { container } = render(
      <ToolCallDisplay
        tool="run_command"
        args={{ command: 'make build' }}
        status="pending"
        variant="expandable"
        streamingOutput={[{ stream: 'stdout', content: 'y'.repeat(10_000) }]}
      />,
    )

    expect(container.textContent).toContain('command output content')
  })

  it('expands large write_file content by default', () => {
    const bigContent = 'z'.repeat(10_000)
    const { container } = render(
      <ToolCallDisplay
        tool="write_file"
        args={{ path: '/tmp/x.ts', content: bigContent }}
        status="success"
        variant="expandable"
      />,
    )

    expect(container.querySelector('[data-testid="file-preview"]')).not.toBeNull()
  })
})
