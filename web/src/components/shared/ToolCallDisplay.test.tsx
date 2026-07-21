// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '../../stores/session'
import { useSettingsStore } from '../../stores/settings'
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

const pendingConfirmation = {
  callId: 'call-run-1',
  tool: 'run_command',
  paths: ['/tmp/project/script.sh'],
  workdir: '/tmp/project',
  reason: 'dangerous_command' as const,
}

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
})
