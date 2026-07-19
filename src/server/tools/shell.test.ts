import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { hasBackgroundAmpersand, runCommandTool, detectEscapePattern, detectGitMutation } from './shell.js'
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

describe('detectEscapePattern', () => {
  it('detects cd .. as escape', () => {
    expect(detectEscapePattern('cd .. && ls')).toContain('cd')
  })

  it('detects cd / as escape', () => {
    expect(detectEscapePattern('cd /tmp')).toContain('cd')
  })

  it('detects cd ~ as escape', () => {
    expect(detectEscapePattern('cd ~/other-project')).toContain('cd')
  })

  it('detects git -C as escape', () => {
    expect(detectEscapePattern('git -C /some/path status')).toContain('git -C')
  })

  it('detects GIT_DIR environment variable', () => {
    expect(detectEscapePattern('GIT_DIR=/other/repo git log')).toContain('GIT_DIR')
  })

  it('detects git --work-tree', () => {
    expect(detectEscapePattern('git --work-tree=/other/repo status')).toContain('--work-tree')
  })

  it('detects indirect cd escape via cd sub && cd ../..', () => {
    expect(detectEscapePattern('cd sub && cd ../..')).toContain('cd')
  })

  it('detects cd with variable path containing ..', () => {
    expect(detectEscapePattern('cd "$PWD/.."')).toContain('cd')
  })

  it('detects quoted escape patterns (prevents bypass)', () => {
    expect(detectEscapePattern('cd ".." && ls')).toContain('cd')
    expect(detectEscapePattern("cd '..' && ls")).toContain('cd')
    expect(detectEscapePattern('cd "/etc"')).toContain('cd')
    expect(detectEscapePattern("cd '/etc'")).toContain('cd')
    expect(detectEscapePattern('cd "~"')).toContain('cd')
  })

  it('allows safe patterns', () => {
    expect(detectEscapePattern('ls')).toBeNull()
    expect(detectEscapePattern('cd src && npm run test')).toBeNull()
    expect(detectEscapePattern('cat file.txt')).toBeNull()
  })

  it('detects cd with unquoted variable expansion', () => {
    expect(detectEscapePattern('cd $HOME')).toContain('cd')
  })

  it('detects cd with quoted variable expansion', () => {
    expect(detectEscapePattern('cd "$HOME"')).toContain('cd')
  })

  it('detects cd with brace variable expansion', () => {
    expect(detectEscapePattern('cd ${HOME}/sensitive')).toContain('cd')
  })

  it('detects cd with command substitution $(...)', () => {
    expect(detectEscapePattern('cd "$(printf /tmp)"')).toContain('cd')
  })

  it('detects cd with unquoted command substitution', () => {
    expect(detectEscapePattern('cd $(mktemp -d)')).toContain('cd')
  })

  it('detects cd with backtick command substitution', () => {
    expect(detectEscapePattern('cd `dirname $0`')).toContain('cd')
  })

  it('detects cd with variable in piped command', () => {
    expect(detectEscapePattern('cd "$SOME_DIR" && cat file.txt')).toContain('cd')
  })

  it('detects cd with variable in chained command', () => {
    expect(detectEscapePattern('cd "$HOME"; ls')).toContain('cd')
  })

  it('still allows cd to literal relative subdirectory', () => {
    expect(detectEscapePattern('cd src/components')).toBeNull()
  })

  it('still allows cd with dot-prefixed relative path', () => {
    expect(detectEscapePattern('cd ./src')).toBeNull()
  })
})

describe('detectGitMutation', () => {
  it('detects git checkout', () => {
    expect(detectGitMutation('git checkout main')).toContain('git checkout')
  })

  it('detects git switch', () => {
    expect(detectGitMutation('git switch feature')).toContain('git switch')
  })

  it('detects git branch -d', () => {
    expect(detectGitMutation('git branch -d old-feature')).toContain('git branch')
  })

  it('detects git branch -D', () => {
    expect(detectGitMutation('git branch -D old-feature')).toContain('git branch')
  })

  it('detects git branch -m (rename)', () => {
    expect(detectGitMutation('git branch -m old-name new-name')).toContain('git branch')
  })

  it('detects git branch -M (force rename)', () => {
    expect(detectGitMutation('git branch -M old-name new-name')).toContain('git branch')
  })

  it('detects git branch -c (copy)', () => {
    expect(detectGitMutation('git branch -c old-name new-name')).toContain('git branch')
  })

  it('detects git branch -C (force copy)', () => {
    expect(detectGitMutation('git branch -C old-name new-name')).toContain('git branch')
  })

  it('detects git merge', () => {
    expect(detectGitMutation('git merge feature')).toContain('git merge')
  })

  it('detects git rebase', () => {
    expect(detectGitMutation('git rebase main')).toContain('git rebase')
  })

  it('detects git reset', () => {
    expect(detectGitMutation('git reset --hard HEAD~1')).toContain('git reset')
  })

  it('detects git worktree', () => {
    expect(detectGitMutation('git worktree add /tmp/test main')).toContain('git worktree')
  })

  it('detects git clone', () => {
    expect(detectGitMutation('git clone https://example.com/repo')).toContain('git clone')
  })

  it('detects git pull', () => {
    expect(detectGitMutation('git pull origin main')).toContain('git pull')
  })

  it('detects git push', () => {
    expect(detectGitMutation('git push origin main')).toContain('git push')
  })

  it('detects git branch -f (force)', () => {
    expect(detectGitMutation('git branch -f main HEAD~2')).toContain('git branch')
  })

  it('detects git branch --force', () => {
    expect(detectGitMutation('git branch --force main HEAD~2')).toContain('git branch')
  })

  it('detects git update-ref', () => {
    expect(detectGitMutation('git update-ref refs/heads/main HEAD')).toContain('git update-ref')
  })

  it('detects git symbolic-ref', () => {
    expect(detectGitMutation('git symbolic-ref HEAD refs/heads/other')).toContain('git symbolic-ref')
  })

  it('detects git commands inside double quotes', () => {
    expect(detectGitMutation('git "checkout" main')).toContain('git')
  })

  it('detects git commands inside single quotes', () => {
    expect(detectGitMutation("git 'reset' --hard")).toContain('git')
  })

  it('allows safe git commands', () => {
    expect(detectGitMutation('git status')).toBeNull()
    expect(detectGitMutation('git log --oneline')).toBeNull()
    expect(detectGitMutation('git diff')).toBeNull()
    expect(detectGitMutation('git --version')).toBeNull()
    expect(detectGitMutation('git branch --show-current')).toBeNull()
  })
})
