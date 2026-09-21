// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolCallPreparing } from './ToolCallPreparing'
import { SETTINGS_KEYS, settingResource } from '../../lib/resources'
import { clearCache } from '../../lib/resourceCache'

const { filePreviewMock, diffViewMock, editContextViewMock } = vi.hoisted(() => ({
  filePreviewMock: vi.fn((_props: unknown) => <div data-testid="file-preview" />),
  diffViewMock: vi.fn((_props: unknown) => <div data-testid="diff-view" />),
  editContextViewMock: vi.fn((_props: unknown) => <div data-testid="edit-context-view" />),
}))

vi.mock('./DiffView', () => ({
  FilePreview: (props: unknown) => filePreviewMock(props),
  DiffView: (props: unknown) => diffViewMock(props),
  EditContextView: (props: unknown) => editContextViewMock(props),
}))

beforeEach(() => {
  clearCache()
})

afterEach(cleanup)

describe('ToolCallPreparing remote execution', () => {
  it('frames remote SSH commands with purple border', () => {
    const { container } = render(<ToolCallPreparing name="run_command" arguments={'{"command":"ssh host'} />)

    expect(container.textContent).not.toContain('REMOTE')
    expect(container.firstElementChild?.className).toContain('border-text-thinking')
  })

  it('frames nested remote commands with purple border', () => {
    const { container } = render(
      <ToolCallPreparing name="run_command" arguments={JSON.stringify({ command: "bash -lc 'setsid ssh host'" })} />,
    )

    expect(container.textContent).not.toContain('REMOTE')
    expect(container.firstElementChild?.className).toContain('border-text-thinking')
  })

  it('does not mark local commands as remote', () => {
    const { container } = render(<ToolCallPreparing name="run_command" arguments={'{"command":"echo ssh"'} />)

    expect(container.textContent).not.toContain('REMOTE')
    expect(container.firstElementChild?.className).not.toContain('border-text-thinking')
  })
})

describe('ToolCallPreparing live file preview', () => {
  beforeEach(() => {
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_SHOW_TOOL_CALL_STREAMING)
  })

  it('shows the placeholder while write_file content is not yet streamed', () => {
    const { container } = render(<ToolCallPreparing name="write_file" arguments={'{"path":"src/a.ts"'} />)

    expect(container.querySelector('[data-testid="file-preview"]')).toBeNull()
    expect(container.textContent).toContain('Writing file')
  })

  it('renders FilePreview with live content for a partial write_file fragment', () => {
    filePreviewMock.mockClear()
    render(<ToolCallPreparing name="write_file" arguments={'{"path":"src/a.ts","content":"const x = 1'} />)

    expect(filePreviewMock).toHaveBeenCalledTimes(1)
    expect(filePreviewMock.mock.calls[0]![0]).toMatchObject({
      filePath: 'src/a.ts',
      content: 'const x = 1',
      streaming: true,
    })
  })

  it('unescapes streamed JSON content for write_file', () => {
    filePreviewMock.mockClear()
    render(<ToolCallPreparing name="write_file" arguments={'{"path":"src/a.ts","content":"line1\\nline2'} />)

    expect(filePreviewMock.mock.calls[0]![0]).toMatchObject({ content: 'line1\nline2' })
  })

  it('updates the live content as the fragment grows', () => {
    filePreviewMock.mockClear()
    const { rerender } = render(
      <ToolCallPreparing name="write_file" arguments={'{"path":"src/a.ts","content":"const x = 1'} />,
    )

    rerender(<ToolCallPreparing name="write_file" arguments={'{"path":"src/a.ts","content":"const x = 1;\\n"}'} />)

    expect(filePreviewMock).toHaveBeenCalledTimes(2)
    expect(filePreviewMock.mock.calls[1]![0]).toMatchObject({ content: 'const x = 1;\n' })
  })

  it('renders DiffView with live old/new for a partial edit_file fragment', () => {
    diffViewMock.mockClear()
    render(
      <ToolCallPreparing
        name="edit_file"
        arguments={'{"path":"src/a.ts","old_string":"const x = 1","new_string":"const x'}
      />,
    )

    expect(diffViewMock).toHaveBeenCalledTimes(1)
    expect(diffViewMock.mock.calls[0]![0]).toMatchObject({
      filePath: 'src/a.ts',
      oldString: 'const x = 1',
      newString: 'const x',
    })
  })

  it('renders EditContextView with live context when the server streams it', () => {
    editContextViewMock.mockClear()
    diffViewMock.mockClear()
    const regions = [
      {
        startLine: 3,
        endLine: 3,
        beforeContext: [{ lineNumber: 2, content: 'line two' }],
        afterContext: [{ lineNumber: 4, content: 'line four' }],
        oldContent: 'const x = 1',
        newContent: 'const x = 2',
        edits: [{ startLine: 3, endLine: 3, oldContent: 'const x = 1', newContent: 'const x = 2' }],
      },
    ]
    render(
      <ToolCallPreparing
        name="edit_file"
        arguments={'{"path":"src/a.ts","old_string":"const x = 1","new_string":"const x = 2"}'}
        editContext={regions}
      />,
    )

    expect(editContextViewMock).toHaveBeenCalledTimes(1)
    expect(editContextViewMock.mock.calls[0]![0]).toMatchObject({ regions, filePath: 'src/a.ts' })
    expect(diffViewMock).not.toHaveBeenCalled()
  })

  it('renders FilePreview even when the streamed content is an empty string', () => {
    filePreviewMock.mockClear()
    render(<ToolCallPreparing name="write_file" arguments={'{"path":"src/a.ts","content":""'} />)

    expect(filePreviewMock).toHaveBeenCalledTimes(1)
    expect(filePreviewMock.mock.calls[0]![0]).toMatchObject({ filePath: 'src/a.ts', content: '' })
  })

  it('shows the placeholder while edit_file has no old/new content yet', () => {
    const { container } = render(<ToolCallPreparing name="edit_file" arguments={'{"path":"src/a.ts"'} />)

    expect(container.querySelector('[data-testid="diff-view"]')).toBeNull()
    expect(container.textContent).toContain('Editing file')
  })

  it('keeps the placeholder card (no live body) when forceCompact is set', () => {
    const { container } = render(
      <ToolCallPreparing name="write_file" arguments={'{"path":"src/a.ts","content":"const x = 1'} forceCompact />,
    )

    expect(container.querySelector('[data-testid="file-preview"]')).toBeNull()
    expect(container.textContent).toContain('Writing file')
  })

  it('hides the live preview when the show tool call streaming setting is off', () => {
    settingResource.write('false', SETTINGS_KEYS.DISPLAY_SHOW_TOOL_CALL_STREAMING)
    filePreviewMock.mockClear()
    const { container } = render(
      <ToolCallPreparing name="write_file" arguments={'{"path":"src/a.ts","content":"const x = 1'} />,
    )

    expect(filePreviewMock).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="file-preview"]')).toBeNull()
    expect(container.textContent).toContain('Writing file')
  })
})

describe('ToolCallPreparing live file preview default', () => {
  it('hides the live preview by default (opt-in setting)', () => {
    filePreviewMock.mockClear()
    const { container } = render(
      <ToolCallPreparing name="write_file" arguments={'{"path":"src/a.ts","content":"const x = 1'} />,
    )

    expect(filePreviewMock).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="file-preview"]')).toBeNull()
    expect(container.textContent).toContain('Writing file')
  })
})
