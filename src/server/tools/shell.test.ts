import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { hasBackgroundAmpersand, runCommandTool, detectGitMutation, formatDuration } from './shell.js'
import { PathAccessDeniedError, providePathConfirmation } from './path-security.js'
import type { ToolContext, ToolResult } from './types.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The confirmation settings are mutable so the tool-level tests can turn the
// workspace-action confirmations on: with them off, requestUserConfirmation
// auto-approves and no prompt would ever be observable.
const settingsState = vi.hoisted(() => ({ confirmOnWorkspaceActions: 'false' }))

// Force the fr display locale for every test in this file: the LLM-facing
// run_command error strings must remain English no matter the UI locale.
vi.mock('../db/settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/settings.js')>()
  return {
    ...actual,
    getSetting: (key: string) => {
      if (key === actual.SETTINGS_KEYS.DISPLAY_LOCALE) return 'fr'
      if (key === actual.SETTINGS_KEYS.CONFIRM_ON_WORKSPACE_ACTIONS) return settingsState.confirmOnWorkspaceActions
      return 'false'
    },
  }
})

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

describe('detectGitMutation — worktree subcommands', () => {
  it('allows the read-only worktree list and its output variants', () => {
    expect(detectGitMutation('git worktree list')).toBeNull()
    expect(detectGitMutation('git worktree list --porcelain')).toBeNull()
    expect(detectGitMutation('git worktree list -v')).toBeNull()
    expect(detectGitMutation('git worktree list --porcelain -z')).toBeNull()
    expect(detectGitMutation('git -C /repo worktree list')).toBeNull()
  })

  it.each([
    'git worktree add /tmp/test main',
    'git worktree add -f /tmp/test main',
    'git worktree remove /tmp/test',
    'git worktree remove -f /tmp/test',
    'git worktree move /tmp/test /tmp/other',
    'git worktree prune',
    'git worktree prune -v',
    'git worktree repair',
    'git worktree lock /tmp/test',
    'git worktree lock --reason wip /tmp/test',
    'git worktree unlock /tmp/test',
  ])('keeps %s classified as a mutation', (command) => {
    expect(detectGitMutation(command)).toContain('git worktree')
  })
})

describe('detectGitMutation — symbolic-ref read vs write', () => {
  it('allows the read-only forms', () => {
    expect(detectGitMutation('git symbolic-ref HEAD')).toBeNull()
    expect(detectGitMutation('git symbolic-ref --short HEAD')).toBeNull()
    expect(detectGitMutation('git symbolic-ref --quiet HEAD')).toBeNull()
  })

  it('detects the write and delete forms', () => {
    expect(detectGitMutation('git symbolic-ref HEAD refs/heads/other')).toContain('git symbolic-ref')
    expect(detectGitMutation('git symbolic-ref HEAD refs/heads/other refs/heads/main')).toContain('git symbolic-ref')
    expect(detectGitMutation('git symbolic-ref --delete refs/heads/other')).toContain('git symbolic-ref')
    expect(detectGitMutation('git symbolic-ref -d refs/heads/other')).toContain('git symbolic-ref')
  })
})

describe('detectGitMutation — clean destructive vs dry-run', () => {
  it.each([
    'git clean -fd',
    'git clean -fxd',
    'git clean -f -d',
    'git clean -dfx',
    'git clean -fdx',
    'git clean -d -f',
  ])('detects the destructive spelling %s', (command) => {
    expect(detectGitMutation(command)).toContain('git clean')
  })

  it.each(['git clean -n', 'git clean --dry-run', 'git clean -nd', 'git clean -n -d'])(
    'allows the dry-run spelling %s',
    (command) => {
      expect(detectGitMutation(command)).toBeNull()
    },
  )

  it('allows routine local writes', () => {
    expect(detectGitMutation('git add .')).toBeNull()
    expect(detectGitMutation('git add -A')).toBeNull()
    expect(detectGitMutation('git commit -m "msg"')).toBeNull()
    expect(detectGitMutation('git commit --amend --no-edit')).toBeNull()
  })
})

describe('detectGitMutation — global options, quoting and chaining', () => {
  it('keeps mutating subcommands behind global options detected', () => {
    expect(detectGitMutation('git -C /repo worktree add /tmp/test main')).toContain('git worktree')
    expect(detectGitMutation('git --git-dir=/repo/.git worktree add /tmp/test main')).toContain('git worktree')
    expect(detectGitMutation('git --work-tree=/repo worktree add /tmp/test main')).toContain('git worktree')
  })

  it('distinguishes quoted read and write forms', () => {
    expect(detectGitMutation('git "worktree" list')).toBeNull()
    expect(detectGitMutation("git 'worktree' list")).toBeNull()
    expect(detectGitMutation("git 'reset' --hard")).toContain('git')
  })

  it('detects mutations hidden behind a harmless read in a chain', () => {
    expect(detectGitMutation('git worktree list; git worktree add /tmp/test main')).toContain('git worktree')
    expect(detectGitMutation('git status && git clean -fd')).toContain('git clean')
    expect(detectGitMutation('git log | git reset --hard')).toContain('git')
  })

  it('allows the original compound reproduction', () => {
    expect(detectGitMutation("git worktree list; git branch -a --list '*perf*'; grep -n pattern docs/file")).toBeNull()
    expect(detectGitMutation('git worktree list && git branch -a')).toBeNull()
    expect(detectGitMutation('git worktree list | head')).toBeNull()
  })

  it('detects mutations executed through command substitution', () => {
    expect(detectGitMutation('echo "$(git clean -fd)"')).toContain('git clean')
    expect(detectGitMutation('x=$(git reset --hard)')).toContain('git')
    expect(detectGitMutation('echo `git clean -fd`')).toContain('git clean')
  })

  it('fails closed on unresolvable aliases and wrappers', () => {
    expect(detectGitMutation('git wt')).not.toBeNull()
    expect(detectGitMutation('env git worktree list')).not.toBeNull()
  })

  it('detects mutations executed through a shell wrapper', () => {
    expect(detectGitMutation('sh -c "git clean -fd"')).toContain('git clean')
    expect(detectGitMutation("bash -c 'git reset --hard'")).toContain('git')
    expect(detectGitMutation('eval "git clean -fd"')).toContain('git clean')
  })

  it('detects a mutation that follows a read-only command in the shell payload', () => {
    expect(detectGitMutation('sh -c "git status; git clean -fd"')).toContain('git clean')
    expect(detectGitMutation('sh -c "git status; git reset --hard"')).toContain('git')
    expect(detectGitMutation('sh -c "git worktree list; git worktree add /tmp/test main"')).toContain('git worktree')
    expect(detectGitMutation('bash -lc "git status; git clean -fd"')).toContain('git clean')
  })

  it('detects a mutation hidden behind a wrapper that takes options', () => {
    expect(detectGitMutation('sudo -u root git reset --hard')).not.toBeNull()
    expect(detectGitMutation('env -i git reset --hard')).not.toBeNull()
    expect(detectGitMutation('nohup git clean -fd')).not.toBeNull()
    expect(detectGitMutation('time -p git reset --hard')).not.toBeNull()
  })

  it('detects a mutation inside a shell payload that runs behind a wrapper', () => {
    expect(detectGitMutation('sudo sh -c "git reset --hard"')).not.toBeNull()
    expect(detectGitMutation('env sh -c "git reset --hard"')).not.toBeNull()
    expect(detectGitMutation('nohup bash -c "git checkout main"')).not.toBeNull()
    expect(detectGitMutation('su -c "git reset --hard"')).not.toBeNull()
    expect(detectGitMutation('timeout 5 sh -c "git reset --hard"')).not.toBeNull()
    expect(detectGitMutation('watch -c "git reset --hard"')).not.toBeNull()
  })

  it('allows the read-only form through a shell wrapper', () => {
    expect(detectGitMutation('sh -c "git worktree list"')).toBeNull()
  })

  it('does not report a non-Git command that runs behind a wrapper', () => {
    expect(detectGitMutation('sudo sh -c "npm run build"')).toBeNull()
    expect(detectGitMutation('timeout 5 "npm test"')).toBeNull()
    expect(detectGitMutation('sudo "apt install x"')).toBeNull()
  })

  it('detects a Git mutation executed through an absolute path', () => {
    expect(detectGitMutation('/usr/bin/git reset --hard')).not.toBeNull()
    expect(detectGitMutation('sudo /usr/bin/git reset --hard')).not.toBeNull()
    expect(detectGitMutation('/usr/local/bin/git worktree add /tmp/test main')).not.toBeNull()
    expect(detectGitMutation('C:\\Program Files\\Git\\bin\\git.exe reset --hard')).not.toBeNull()
  })

  it('does not report a command that merely mentions the word git', () => {
    expect(detectGitMutation('sudo apt install git')).toBeNull()
    expect(detectGitMutation('sudo yum install -y git')).toBeNull()
    expect(detectGitMutation('sudo ls /opt/git')).toBeNull()
    expect(detectGitMutation('grep git README.md')).toBeNull()
    expect(detectGitMutation('echo git status')).toBeNull()
    expect(detectGitMutation('grep git log README.md')).toBeNull()
  })

  it('detects a mutation that follows a shell variable expansion', () => {
    expect(detectGitMutation('echo "$HOME"; git reset --hard')).not.toBeNull()
    expect(detectGitMutation('FOO=1; git clean -fd')).not.toBeNull()
    expect(detectGitMutation('echo "$PATH" && git worktree add /tmp/test main')).not.toBeNull()
  })

  it('detects a Git mutation hidden in an interpreter payload', () => {
    expect(detectGitMutation('fish -c "git reset --hard"')).not.toBeNull()
    expect(detectGitMutation('csh -c "git reset --hard"')).not.toBeNull()
    expect(detectGitMutation('ssh host "git reset --hard"')).not.toBeNull()
  })

  it('detects a Git mutation behind a wrapper that is not allowlisted', () => {
    expect(detectGitMutation('docker exec c git reset --hard')).not.toBeNull()
    expect(detectGitMutation('docker compose exec app git reset --hard')).not.toBeNull()
    expect(detectGitMutation('kubectl exec p -- git reset --hard')).not.toBeNull()
    expect(detectGitMutation('ssh host git reset --hard')).not.toBeNull()
    expect(detectGitMutation('ssh -p 22 host git reset --hard')).not.toBeNull()
    expect(detectGitMutation('timeout 5 git reset --hard')).not.toBeNull()
    expect(detectGitMutation('watch git reset --hard')).not.toBeNull()
    expect(detectGitMutation('make git reset --hard')).not.toBeNull()
  })

  it('detects a Git mutation nested in an interpreter source string', () => {
    expect(detectGitMutation('python -c "os.system(\'git reset --hard\')"')).not.toBeNull()
    expect(detectGitMutation('perl -e \'system("git reset --hard")\'')).not.toBeNull()
    expect(detectGitMutation('node -e "execSync(\'git reset --hard\')"')).not.toBeNull()
    expect(detectGitMutation('ruby -e \'system("git reset --hard")\'')).not.toBeNull()
  })

  it('detects a Git mutation that follows a bare variable expansion', () => {
    expect(detectGitMutation('echo $HOME; git reset --hard')).not.toBeNull()
    expect(detectGitMutation('cd $DIR && git reset --hard')).not.toBeNull()
    expect(detectGitMutation('X=$FOO; git reset --hard')).not.toBeNull()
  })

  it('fails closed on a dynamic interpreter payload', () => {
    expect(detectGitMutation('sh -c $CMD')).not.toBeNull()
    expect(detectGitMutation('eval $CMD')).not.toBeNull()
  })

  it('detects a Git mutation behind an option value', () => {
    expect(detectGitMutation('docker run --user "root" alpine "git reset --hard"')).not.toBeNull()
    expect(detectGitMutation('sudo -u "root" sh -c "git reset --hard"')).not.toBeNull()
    expect(detectGitMutation('parallel -v "git reset --hard"')).not.toBeNull()
  })

  it('detects a Git mutation hidden in a Windows executor payload', () => {
    expect(detectGitMutation('cmd.exe /c "git reset --hard"')).not.toBeNull()
    expect(detectGitMutation('powershell.exe -Command "git reset --hard"')).not.toBeNull()
    expect(detectGitMutation('pwsh.exe -c "git reset --hard"')).not.toBeNull()
  })

  it('detects a Git mutation executed by an awk/sed program', () => {
    expect(detectGitMutation('awk \'BEGIN{system("git reset --hard")}\'')).not.toBeNull()
    expect(detectGitMutation('sudo awk \'BEGIN{system("git reset --hard")}\'')).not.toBeNull()
    expect(detectGitMutation("sed '1e git reset --hard'")).not.toBeNull()
    expect(detectGitMutation('awk -v cmd="git reset --hard" \'BEGIN{print | cmd}\'')).not.toBeNull()
  })

  it('fails closed on a dynamic wrapper command', () => {
    expect(detectGitMutation('sudo "$CMD"')).not.toBeNull()
    expect(detectGitMutation('sudo $CMD')).not.toBeNull()
    expect(detectGitMutation('$CMD')).not.toBeNull()
    expect(detectGitMutation('"$CMD"')).not.toBeNull()
    expect(detectGitMutation('eval "$CMD"')).not.toBeNull()
  })

  it('fails closed on a runtime awk/sed program', () => {
    expect(detectGitMutation('awk "$PROG"')).not.toBeNull()
    expect(detectGitMutation('sed "$SCRIPT" file')).not.toBeNull()
    expect(detectGitMutation('sed -e "$SCRIPT"')).not.toBeNull()
  })

  it('fails closed on a runtime command behind a runner or ssh', () => {
    expect(detectGitMutation('docker run alpine "$CMD" arg')).not.toBeNull()
    expect(detectGitMutation('docker exec "$POD" "$CMD"')).not.toBeNull()
    expect(detectGitMutation('kubectl exec "$POD" -- "$CMD"')).not.toBeNull()
    expect(detectGitMutation('ssh host "$CMD"')).not.toBeNull()
  })

  it('does not report data-only mentions of git', () => {
    expect(detectGitMutation('man git reset')).toBeNull()
    expect(detectGitMutation('printf git log')).toBeNull()
    expect(detectGitMutation('awk \'BEGIN{print "git reset"}\'')).toBeNull()
    expect(detectGitMutation('sed -n "s/git reset //p" file')).toBeNull()
    expect(detectGitMutation('bash scripts/build.sh "$TARGET"')).toBeNull()
    expect(detectGitMutation('ssh host "awk \'{print $1}\'"')).toBeNull()
    expect(detectGitMutation('docker run -v "$PWD":/app alpine ls')).toBeNull()
    expect(detectGitMutation('kubectl exec "$POD" -- ls')).toBeNull()
    expect(detectGitMutation('docker logs "$C"')).toBeNull()
    expect(detectGitMutation('docker pull "$IMG"')).toBeNull()
  })
})

describe('detectGitMutation — read-only forms of state-changing subcommands', () => {
  it.each([
    'git stash list',
    'git stash show',
    'git stash list --stat',
    'git submodule status',
    'git notes list',
    'git replace -l',
    'git sparse-checkout list',
    'git update-index --refresh',
    'git bisect log',
  ])('does not report the read-only form %s', (command) => {
    expect(detectGitMutation(command)).toBeNull()
  })

  it.each([
    'git stash push -m wip',
    'git stash pop',
    'git submodule update',
    'git notes add note',
    'git replace -g old new',
    'git sparse-checkout set src',
    'git update-index --cacheinfo 1234,file',
  ])('still reports the mutating form %s', (command) => {
    expect(detectGitMutation(command)).not.toBeNull()
  })
})

describe('detectGitMutation — fetch/push dry-run semantics', () => {
  it('keeps fetch and push as remote-affecting, dry-run or not', () => {
    expect(detectGitMutation('git fetch origin')).toContain('git fetch')
    expect(detectGitMutation('git fetch --dry-run origin')).toContain('git fetch')
    expect(detectGitMutation('git push origin main')).toContain('git push')
    expect(detectGitMutation('git push --dry-run origin main')).toContain('git push')
  })
})

describe('formatDuration', () => {
  const cases: Array<[number, string]> = [
    [0, '0ms'],
    [42, '42ms'],
    [999, '999ms'],
    [1000, '1.0s'],
    [4200, '4.2s'],
    [59999, '60.0s'],
    [60000, '1m 0s'],
    [61000, '1m 1s'],
    [125000, '2m 5s'],
  ]

  it.each(cases)('formatDuration(%i) === %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})

describe('run_command duration reporting', () => {
  let tempDir: string
  let context: ToolContext

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shell-duration-test-'))
    context = baseContext(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('appends a [Duration: …] line to normal runs', async () => {
    const result = await runCommandTool.execute({ command: 'echo hi', timeout: 10000 }, context)

    expect(result.success).toBe(true)
    expect(result.output).toContain('[Exit code: 0]')
    expect(result.output).toMatch(/\[Duration: \d+ms\]\s*$/)
  }, 15000)

  it('reports a positive duration for interrupted runs', async () => {
    const controller = new AbortController()
    const context: ToolContext = { ...baseContext(tempDir), signal: controller.signal }

    const pending = runCommandTool.execute({ command: 'node -e "setTimeout(() => {}, 5000)"', timeout: 10000 }, context)
    await new Promise((r) => setTimeout(r, 300))
    controller.abort()

    const result = await pending
    const output = result.output ?? ''
    expect(output).toContain('[interrupted by user]')
    expect(output).toContain('[Exit code: 130]')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/interrupted/i)
    // Server is the single source of truth for "interrupted" — the client
    // must not re-derive it from output heuristics.
    expect(result.metadata?.['interrupted']).toBe(true)

    const match = output.match(/\[Duration: ([\d.]+)(ms|s)\]|\[Duration: (\d+)m (\d+)s\]/)
    expect(match).not.toBeNull()
    expect(parseDurationMs(match!)).toBeGreaterThan(0)
  }, 15000)

  it('does not flag a non-interrupted run with metadata.interrupted', async () => {
    const result = await runCommandTool.execute({ command: 'echo hi', timeout: 10000 }, context)
    expect(result.success).toBe(true)
    expect(result.metadata?.['interrupted']).toBeUndefined()
  }, 15000)

  it('does not treat a command that prints the marker and exits 1 as interrupted', async () => {
    const result = await runCommandTool.execute(
      { command: `echo '[interrupted by user]' && exit 1`, timeout: 10000 },
      context,
    )
    expect(result.success).toBe(false)
    expect(result.metadata?.['interrupted']).toBeUndefined()
    expect(result.error).toMatch(/exited with code 1/)
  }, 15000)

  it('keeps the [Duration: …] line after output truncation', async () => {
    const result = await runCommandTool.execute(
      { command: `node -e "process.stdout.write('X'.repeat(51000))"`, timeout: 10000 },
      context,
    )

    expect(result.truncated).toBe(true)
    const output = result.output ?? ''
    expect(output).toContain('[Output truncated due to size limit]')
    expect(output).toMatch(/\[Duration: \d+ms\]\s*$/)
    expect(output.indexOf('[Duration:')).toBeGreaterThan(output.indexOf('[Output truncated due to size limit]'))
  }, 15000)
})

describe('run_command LLM-facing errors under fr locale (module mock forces display.locale=fr)', () => {
  let tempDir: string
  let context: ToolContext

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shell-fr-test-'))
    context = baseContext(tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('keeps the interrupted-run error in English', async () => {
    const controller = new AbortController()
    const ctx: ToolContext = { ...context, signal: controller.signal }
    const pending = runCommandTool.execute({ command: 'node -e "setTimeout(() => {}, 5000)"', timeout: 10000 }, ctx)
    await new Promise((r) => setTimeout(r, 300))
    controller.abort()
    const result = await pending

    expect(result.error).toBe('Command was interrupted by user')
  }, 15000)

  it('keeps the exit-code error in English', async () => {
    const result = await runCommandTool.execute({ command: 'exit 1', timeout: 10000 }, context)

    expect(result.success).toBe(false)
    expect(result.error).toBe('Command exited with code 1')
  }, 15000)
})

function baseContext(tempDir: string): ToolContext {
  return {
    sessionManager: {
      recordFileRead: vi.fn(),
      getReadFiles: vi.fn().mockReturnValue({}),
      updateFileHash: vi.fn(),
    } as any,
    workdir: tempDir,
    sessionId: 'test-session',
  }
}

describe('run_command Git confirmation gating (tool level)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shell-git-gate-'))
    settingsState.confirmOnWorkspaceActions = 'true'
  })

  afterEach(async () => {
    settingsState.confirmOnWorkspaceActions = 'false'
    await rm(tempDir, { recursive: true, force: true })
  })

  /**
   * Run a command with the workspace-action confirmations enabled and record
   * whether a confirmation was requested.
   *
   * @returns The tool result and the number of requested confirmations
   */
  async function runWithConfirmation(
    command: string,
    options: { approve?: boolean; context?: Partial<ToolContext> } = {},
  ): Promise<{ result: ToolResult; confirmations: number; gitConfirmations: string[] }> {
    let confirmations = 0
    const gitConfirmations: string[] = []
    const context: ToolContext = {
      ...baseContext(tempDir),
      toolCallId: 'call-git-gate',
      onEvent: (event: unknown) => {
        const message = event as { type?: string; payload?: { callId?: string; tool?: string; paths?: string[] } }
        if (message.type !== 'chat.path_confirmation') return
        confirmations += 1
        // The Git-state confirmation is issued with the 'command' tool label,
        // the dangerous-command confirmation with the tool's own name.
        if (message.payload?.tool === 'command') {
          gitConfirmations.push((message.payload?.paths ?? []).join(' '))
        }
        const callId = message.payload?.callId
        if (callId) providePathConfirmation(callId, options.approve ?? true)
      },
      ...options.context,
    }

    // A dangerous-command denial is thrown (the framework re-throws
    // PathAccessDeniedError for the orchestrator); a Git denial is returned as
    // an error result. Normalise both to a failed result so the tests can
    // assert on the outcome.
    let result: ToolResult
    try {
      result = await runCommandTool.execute({ command, timeout: 10000 }, context)
    } catch (error) {
      if (!(error instanceof PathAccessDeniedError)) throw error
      result = { success: false, error: error.message, durationMs: 0, truncated: false }
    }
    return { result, confirmations, gitConfirmations }
  }

  it.each([
    'git worktree list',
    'git worktree list --porcelain',
    'git -C /tmp worktree list',
    "git worktree list; git branch -a --list '*perf*'; grep -n pattern docs/file",
    'git worktree list && git branch -a',
    'git worktree list | head',
  ])('requests no Git confirmation for the read-only command %s', async (command) => {
    const { result, confirmations } = await runWithConfirmation(command)

    expect(confirmations).toBe(0)
    // The command itself may fail (the temp dir is not a Git repository), but
    // it must never be blocked by a Git-state confirmation.
    expect(result.error ?? '').not.toContain('User denied')
  })

  it.each(['git clean -fd', 'git clean -fxd', 'git clean -f -d', 'git clean -dfx'])(
    'requests a Git confirmation for the destructive command %s',
    async (command) => {
      const { gitConfirmations } = await runWithConfirmation(command)

      expect(gitConfirmations.length).toBeGreaterThan(0)
    },
  )

  it.each(['git clean -n', 'git clean --dry-run', 'git clean -nd'])(
    'requests no confirmation for the dry-run command %s',
    async (command) => {
      const { confirmations } = await runWithConfirmation(command)

      expect(confirmations).toBe(0)
    },
  )

  it.each(['git add .', 'git commit -m "msg"'])(
    'requests no Git confirmation for the routine local write %s',
    async (command) => {
      const { confirmations } = await runWithConfirmation(command)

      expect(confirmations).toBe(0)
    },
  )

  it('requests a Git confirmation for the mutating symbolic-ref form', async () => {
    const { gitConfirmations } = await runWithConfirmation('git symbolic-ref HEAD refs/heads/other')

    expect(gitConfirmations.length).toBeGreaterThan(0)
  })

  it('requests no Git confirmation for the read-only symbolic-ref form', async () => {
    const { gitConfirmations } = await runWithConfirmation('git symbolic-ref HEAD')

    expect(gitConfirmations.length).toBe(0)
  })

  it('requests a dangerous-command confirmation for an executable nested sudo', async () => {
    const { confirmations } = await runWithConfirmation('echo "$(sudo whoami)"')

    expect(confirmations).toBeGreaterThan(0)
  })

  it('requests no confirmation for a quoted sudo search', async () => {
    const { confirmations } = await runWithConfirmation("grep -R 'sudo ' docs/")

    expect(confirmations).toBe(0)
  })

  it.each([
    '$CMD',
    'eval "$CMD"',
    'sudo "$CMD"',
    'sudo $CMD',
    'sh -c "$CMD"',
    'awk \'BEGIN{system("sudo whoami")}\'',
    "sed '1e sudo whoami'",
    'docker run alpine "rm -rf ~/" "extra"',
    'ssh host "rm -rf ~/" "extra"',
    'parallel "echo hi" "sudo x"',
    'ssh "host" "sudo rm -rf /"',
    'awk "$PROG"',
    'sed "$SCRIPT" file',
    'sed -e "$SCRIPT"',
    'gawk \'BEGIN{system("sudo whoami")}\'',
    'docker run alpine "$CMD"',
    'docker run alpine "$CMD" arg',
    'kubectl exec "$POD" -- "$CMD"',
    'ssh host "$CMD"',
  ])('requests a confirmation for the unresolved or dangerous command %s', async (command) => {
    const { result, confirmations } = await runWithConfirmation(command, { approve: false })

    expect(confirmations).toBeGreaterThan(0)
    expect(result.success).toBe(false)
  })

  it.each([
    '$CMD',
    'sudo "$CMD"',
    'awk \'BEGIN{system("git reset --hard")}\'',
    'sudo awk \'BEGIN{system("git reset --hard")}\'',
  ])('requests a Git confirmation for the unresolved Git command %s', async (command) => {
    const { result, gitConfirmations } = await runWithConfirmation(command, { approve: false })

    expect(gitConfirmations.length).toBeGreaterThan(0)
    expect(result.success).toBe(false)
  })

  it.each([
    'man git reset',
    'printf git log',
    'awk \'BEGIN{print "sudo test"}\'',
    'sed -n "s/sudo //p" file',
    'docker run alpine echo "sudo test"',
    'bash scripts/build.sh "$TARGET"',
    'timeout 60 curl "$URL"',
    'xargs curl "$URL"',
  ])('requests no confirmation for the data-only command %s', async (command) => {
    const { confirmations, gitConfirmations } = await runWithConfirmation(command)

    expect(confirmations).toBe(0)
    expect(gitConfirmations.length).toBe(0)
  })

  it('does not request a Git confirmation for a Git word that is echo data behind sudo', async () => {
    // sudo itself still requires approval, but the quoted Git text is data.
    const { result, gitConfirmations } = await runWithConfirmation('sudo echo "git reset --hard"', { approve: false })

    expect(gitConfirmations.length).toBe(0)
    expect(result.success).toBe(false)
  })

  it.each(['sudo "$CMD"', 'awk \'BEGIN{system("sudo whoami")}\'', 'docker run alpine "rm -rf ~/" "extra"'])(
    'denies the unresolved or dangerous command %s in night mode without prompting',
    async (command) => {
      const { result, confirmations } = await runWithConfirmation(command, {
        context: { nightMode: true },
      })

      expect(confirmations).toBe(0)
      expect(result.success).toBe(false)
    },
  )

  it.each(['$CMD', 'awk \'BEGIN{system("sudo whoami")}\'', 'docker run alpine "rm -rf ~/" "extra"'])(
    'denies the unresolved or dangerous command %s for a sub-agent without prompting',
    async (command) => {
      const { result, confirmations } = await runWithConfirmation(command, {
        context: { isSubAgent: true },
      })

      expect(confirmations).toBe(0)
      expect(result.success).toBe(false)
    },
  )

  it('denies the command when the user rejects the Git confirmation', async () => {
    const { result, confirmations } = await runWithConfirmation('git clean -fd', { approve: false })

    expect(confirmations).toBeGreaterThan(0)
    expect(result.success).toBe(false)
  })

  it('denies the Git mutation in night mode without prompting', async () => {
    const { result, confirmations } = await runWithConfirmation('git clean -fd', {
      context: { nightMode: true },
    })

    expect(confirmations).toBe(0)
    expect(result.success).toBe(false)
  })

  it('denies the Git mutation for a sub-agent without prompting', async () => {
    const { result, confirmations } = await runWithConfirmation('git clean -fd', {
      context: { isSubAgent: true },
    })

    expect(confirmations).toBe(0)
    expect(result.success).toBe(false)
  })

  it('auto-approves the Git mutation in dangerous mode', async () => {
    const { confirmations } = await runWithConfirmation('git clean -fd', {
      context: { dangerLevel: 'dangerous' },
    })

    expect(confirmations).toBe(0)
  })
})

function parseDurationMs(match: RegExpMatchArray): number {
  if (match[1]) return Number(match[1]) * (match[2] === 'ms' ? 1 : 1000)
  return Number(match[3]) * 60_000 + Number(match[4]) * 1000
}
