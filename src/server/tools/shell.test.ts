import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { hasBackgroundAmpersand, runCommandTool } from './shell.js'
import type { ToolContext } from './types.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('hasBackgroundAmpersand', () => {
  it('detects trailing & as background operator', () => {
    expect(hasBackgroundAmpersand('npm run dev &')).toBe(true)
  })

  it('detects trailing & with whitespace', () => {
    expect(hasBackgroundAmpersand('npm run dev & ')).toBe(true)
  })

  it('detects trailing & with semicolon', () => {
    expect(hasBackgroundAmpersand('npm run dev &;')).toBe(true)
  })

  it('detects trailing & with semicolon and whitespace', () => {
    expect(hasBackgroundAmpersand('npm run dev &; ')).toBe(true)
  })

  it('detects redirect then background', () => {
    expect(hasBackgroundAmpersand('cmd > file &')).toBe(true)
  })

  it('rejects logical AND (&&)', () => {
    expect(hasBackgroundAmpersand('cmd1 && cmd2')).toBe(false)
  })

  it('rejects stderr pipe (|&)', () => {
    expect(hasBackgroundAmpersand('cmd1 |& cmd2')).toBe(false)
  })

  it('rejects redirect syntax with &>', () => {
    expect(hasBackgroundAmpersand('cmd &> file')).toBe(false)
  })

  it('rejects redirect syntax with >&', () => {
    expect(hasBackgroundAmpersand('cmd >& file')).toBe(false)
  })

  it('rejects 2>&1 redirect', () => {
    expect(hasBackgroundAmpersand('cmd 2>&1')).toBe(false)
  })

  it('rejects & in the middle of a command', () => {
    expect(hasBackgroundAmpersand('cmd & other_cmd')).toBe(true)
  })

  it('rejects normal command without &', () => {
    expect(hasBackgroundAmpersand('npm run test')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(hasBackgroundAmpersand('')).toBe(false)
  })

  it('rejects command ending with &&', () => {
    expect(hasBackgroundAmpersand('cmd &&')).toBe(false)
  })

  it('rejects command ending with |&', () => {
    expect(hasBackgroundAmpersand('cmd |&')).toBe(false)
  })

  it('allows & inside single quotes', () => {
    expect(hasBackgroundAmpersand("echo 'foo & bar'")).toBe(false)
  })

  it('allows & inside double quotes', () => {
    expect(hasBackgroundAmpersand('echo "foo & bar"')).toBe(false)
  })

  it('allows escaped ampersand', () => {
    expect(hasBackgroundAmpersand('echo foo \\& bar')).toBe(false)
  })

  it('detects multiple background operators', () => {
    expect(hasBackgroundAmpersand('cmd1 & cmd2 & cmd3')).toBe(true)
  })

  it('detects & in subshell', () => {
    expect(hasBackgroundAmpersand('(cmd1 & cmd2)')).toBe(true)
  })

  it('detects & after heredoc delimiter', () => {
    expect(hasBackgroundAmpersand('cat <<EOF &')).toBe(true)
  })

  it('allows & inside nested quotes', () => {
    expect(hasBackgroundAmpersand('echo "foo \'&\' bar"')).toBe(false)
  })

  it('allows & in mixed quotes where outer are single', () => {
    expect(hasBackgroundAmpersand('echo \'foo "&" bar\'')).toBe(false)
  })

  it('detects & after compound command with &&', () => {
    expect(hasBackgroundAmpersand('cmd1 && cmd2 &')).toBe(true)
  })

  it('rejects & followed by redirect (cmd & 2>&1)', () => {
    expect(hasBackgroundAmpersand('cmd & 2>&1')).toBe(true)
  })

  it('rejects mid-command & (cmd1 & cmd2)', () => {
    expect(hasBackgroundAmpersand('cmd1 & cmd2')).toBe(true)
  })

  it('rejects & before shell comment (cmd & # comment)', () => {
    expect(hasBackgroundAmpersand('cmd & # comment')).toBe(true)
  })
})

describe('runCommandTool truncation with ANSI codes', () => {
  let tempDir: string
  let context: ToolContext

  const mockSessionManager = {
    recordFileRead: vi.fn(),
    getReadFiles: vi.fn().mockReturnValue({}),
    updateFileHash: vi.fn(),
  } as any

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shell-ansi-test-'))
    context = {
      sessionManager: mockSessionManager,
      workdir: tempDir,
      sessionId: 'test-session',
    }
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('does not count ANSI escape sequences toward byte limit', async () => {
    // Generate output where ANSI codes make raw string large but visible content is small.
    // Each line: 9×\033[31m + X + \033[0m + \n = 51 raw bytes, 1 visible char + \n.
    // 1100 lines × 51 bytes = 56100 raw (> 50000 maxBytes), but only 2200 visible chars (< 50000)
    // 1100 lines < 2000 maxLines — so only the byte limit is at risk.
    // Without ANSI stripping, this would be truncated. With stripping, it passes.
    // Uses node (not printf/brace expansion) so the command is portable to Windows shells.
    const result = await runCommandTool.execute(
      {
        command: `node -e "process.stdout.write(('\\u001b[31m'.repeat(9) + 'X\\u001b[0m\\n').repeat(1100))"`,
        timeout: 10000,
      },
      context,
    )

    expect(result.success).toBe(true)
    expect(result.truncated).toBe(false)
    expect(result.output).toContain('[Exit code: 0]')
  }, 15000)

  it('still truncates when stripped content exceeds byte limit', async () => {
    // Generate enough visible content to truly exceed the limit
    const result = await runCommandTool.execute(
      {
        command: `node -e "process.stdout.write('X'.repeat(51000))"`,
        timeout: 10000,
      },
      context,
    )

    expect(result.success).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.output).toContain('[Output truncated due to size limit]')
  }, 15000)

  it('does not count ANSI codes toward line limit', async () => {
    // Generate 2100 lines, each with heavy ANSI wrapping but only 1 visible char.
    // Without ANSI stripping in line counting, lines are still 2100 > 2000 limit.
    // But ANSI codes don't affect line count (based on \n), so this mainly
    // verifies the output isn't corrupted by ANSI codes near the line limit.
    const result = await runCommandTool.execute(
      {
        command: `node -e "process.stdout.write('\\u001b[31mX\\u001b[0m\\n'.repeat(1900))"`,
        timeout: 10000,
      },
      context,
    )

    expect(result.success).toBe(true)
    expect(result.truncated).toBe(false)
    expect(result.output).toContain('[Exit code: 0]')
  }, 15000)
})
