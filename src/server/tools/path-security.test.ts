import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, symlink, rm, writeFile, realpath } from 'node:fs/promises'
import { symlinkSync, rmSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import {
  isPathWithinSandbox,
  extractAbsolutePathsFromCommand,
  extractSensitivePathsFromCommand,
  addAllowedPath,
  addAllowedPaths,
  checkPathsAccess,
  PathAccessDeniedError,
  clearAllowedPaths,
  isPathAllowed,
  providePathConfirmation,
  cancelPathConfirmationsForSession,
  cancelPathConfirmation,
  hasPendingPathConfirmation,
  isSensitivePath,
  registerPathConfirmation,
  requestPathAccess,
  extractGitNoVerify,
} from './path-security.js'

// Test fixtures directory - use a unique subdir that's NOT in /tmp's allowed root
// We create workdir INSIDE /tmp but treat sibling tests specially
const TEST_DIR = join(tmpdir(), 'openfox-path-security-test')
const WORKDIR = join(TEST_DIR, 'project', 'workdir') // Nested to allow sibling tests
const OUTSIDE_DIR = join(TEST_DIR, 'project', 'outside') // Sibling of workdir but still in /tmp
// For true outside-workdir tests, we use paths that aren't in /tmp
const TRULY_OUTSIDE = '/var/lib' // This is outside both workdir AND the temp root

let CANONICAL_TMP: string
let CANONICAL_WORKDIR: string
let CANONICAL_PASSWD: string
let CANONICAL_VAR_LOG_SYSLOG: string
let CANONICAL_ETC_ENV: string

const REAL_PLATFORM = process.platform

/** Pin process.platform so platform-dependent extraction logic is deterministic. */
function mockPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

/**
 * Canonicalize like the implementation's safeRealpath: realpath when the path
 * exists, plain resolve otherwise. Lets Unix literals such as /etc/passwd act
 * as "nonexistent path outside the sandbox" on Windows (e.g. D:\etc\passwd)
 * instead of crashing the fixtures with ENOENT.
 */
async function canonicalOrResolved(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return normalize(resolve(path))
  }
}

/** Symlink creation needs a privilege/Developer Mode on Windows — probe once. */
const CAN_SYMLINK = (() => {
  if (process.platform !== 'win32') return true
  const probe = join(tmpdir(), `openfox-symlink-probe-${process.pid}`)
  try {
    symlinkSync('probe-target', probe, 'file')
    rmSync(probe)
    return true
  } catch {
    return false
  }
})()

describe('path-security', () => {
  beforeEach(async () => {
    mockPlatform('linux')
    CANONICAL_TMP = await realpath(tmpdir())
    CANONICAL_PASSWD = await canonicalOrResolved('/etc/passwd')
    CANONICAL_VAR_LOG_SYSLOG = join(await canonicalOrResolved('/var'), 'log', 'syslog')
    CANONICAL_ETC_ENV = join(await canonicalOrResolved('/etc'), '.env')
    // Create test directories
    await mkdir(WORKDIR, { recursive: true })
    await mkdir(OUTSIDE_DIR, { recursive: true })
    await mkdir(join(WORKDIR, 'subdir'), { recursive: true })
    await writeFile(join(WORKDIR, 'file.txt'), 'test')
    await writeFile(join(OUTSIDE_DIR, 'secret.txt'), 'secret') // For symlink tests (in /tmp, so creatable)
    CANONICAL_WORKDIR = await realpath(WORKDIR)
  })

  afterEach(async () => {
    mockPlatform(REAL_PLATFORM)
    // Cleanup
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  // ===========================================================================
  // isPathWithinSandbox()
  // ===========================================================================

  describe('isPathWithinSandbox', () => {
    describe('basic allowed paths', () => {
      it('allows path inside workdir', async () => {
        const result = await isPathWithinSandbox(join(WORKDIR, 'file.txt'), WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('allows path in subdirectory of workdir', async () => {
        const result = await isPathWithinSandbox(join(WORKDIR, 'subdir', 'file.txt'), WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('allows path exactly at workdir', async () => {
        const result = await isPathWithinSandbox(WORKDIR, WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('allows path inside /tmp', async () => {
        const result = await isPathWithinSandbox(join(tmpdir(), 'some-file.txt'), WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('allows path exactly at /tmp', async () => {
        const result = await isPathWithinSandbox(tmpdir(), WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('allows nested path in /tmp', async () => {
        const result = await isPathWithinSandbox(join(tmpdir(), 'foo', 'bar', 'baz'), WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('allows path in /var/tmp', async () => {
        const result = await isPathWithinSandbox('/var/tmp/file.txt', WORKDIR)
        expect(result.allowed).toBe(true)
      })
    })

    describe('basic denied paths', () => {
      it('denies path outside workdir', async () => {
        const result = await isPathWithinSandbox('/etc/passwd', WORKDIR)
        expect(result.allowed).toBe(false)
      })

      it('denies path in home dir outside workdir', async () => {
        const home = homedir()
        // Only test if workdir is not in home
        if (!WORKDIR.startsWith(home)) {
          const result = await isPathWithinSandbox(join(home, '.bashrc'), WORKDIR)
          expect(result.allowed).toBe(false)
        }
      })

      it('denies path in /var (not /var/tmp)', async () => {
        const result = await isPathWithinSandbox('/var/log/syslog', WORKDIR)
        expect(result.allowed).toBe(false)
      })

      it('denies sibling directory of workdir (outside /tmp)', async () => {
        // OUTSIDE_DIR is in /tmp so it's allowed - use a truly outside path
        const result = await isPathWithinSandbox(TRULY_OUTSIDE, WORKDIR)
        expect(result.allowed).toBe(false)
      })

      it('denies path to file in directory outside /tmp', async () => {
        const result = await isPathWithinSandbox(join(TRULY_OUTSIDE, 'some-file'), WORKDIR)
        expect(result.allowed).toBe(false)
      })

      it('allows previously approved path outside workdir for the same session', async () => {
        const sessionId = 'approved-outside'
        addAllowedPath(sessionId, '/etc/passwd')
        const result = await isPathWithinSandbox('/etc/passwd', WORKDIR, sessionId)
        expect(result.allowed).toBe(true)
        expect(result.resolvedPath).toBe(CANONICAL_PASSWD)
      })
    })

    describe('relative path escapes', () => {
      it('denies path that escapes /tmp sandbox', async () => {
        // WORKDIR is nested deep in /tmp, so we need many .. to escape
        // Just test with a known outside path
        const result = await isPathWithinSandbox('/etc/passwd', WORKDIR)
        expect(result.allowed).toBe(false)
        expect(result.resolvedPath).toBe(CANONICAL_PASSWD)
      })

      it('denies subdir/../../../../../etc resolved escape', async () => {
        // Need to escape far enough to get out of /tmp entirely
        const maliciousPath = join(WORKDIR, 'subdir', '..', '..', '..', '..', '..', 'etc')
        const result = await isPathWithinSandbox(maliciousPath, WORKDIR)
        expect(result.allowed).toBe(false)
        expect(result.resolvedPath.startsWith(CANONICAL_TMP)).toBe(false)
      })

      it('allows . (current directory)', async () => {
        const result = await isPathWithinSandbox(join(WORKDIR, '.'), WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('allows ./subdir', async () => {
        const result = await isPathWithinSandbox(join(WORKDIR, '.', 'subdir'), WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('allows .. from workdir root if still in /tmp', async () => {
        // Since workdir is in /tmp, going up one level stays in /tmp which is allowed
        const result = await isPathWithinSandbox(join(WORKDIR, '..'), WORKDIR)
        // This actually stays within /tmp, so it's allowed
        expect(result.allowed).toBe(true)
      })

      it('denies escape that leaves /tmp entirely', async () => {
        // Escape all the way out of /tmp
        const result = await isPathWithinSandbox('/var/log', WORKDIR)
        expect(result.allowed).toBe(false)
      })

      it('denies /tmp/../etc via escape', async () => {
        const result = await isPathWithinSandbox('/tmp/../etc/passwd', WORKDIR)
        expect(result.allowed).toBe(false)
        expect(result.resolvedPath).toBe(CANONICAL_PASSWD)
      })
    })

    describe.skipIf(!CAN_SYMLINK)('symlink resolution', () => {
      it('allows symlink inside workdir pointing to file inside workdir', async () => {
        const linkPath = join(WORKDIR, 'link-to-file')
        await symlink(join(WORKDIR, 'file.txt'), linkPath)

        const result = await isPathWithinSandbox(linkPath, WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('denies symlink inside workdir pointing to file outside sandbox', async () => {
        const linkPath = join(WORKDIR, 'evil-link')
        // Point to a path outside /tmp entirely
        await symlink('/etc/passwd', linkPath)

        const result = await isPathWithinSandbox(linkPath, WORKDIR)
        expect(result.allowed).toBe(false)
        expect(result.resolvedPath).toBe(CANONICAL_PASSWD)
      })

      it('allows symlink inside workdir pointing to /tmp', async () => {
        const tmpFile = join(tmpdir(), 'openfox-test-target.txt')
        await writeFile(tmpFile, 'tmp content')
        const linkPath = join(WORKDIR, 'link-to-tmp')
        await symlink(tmpFile, linkPath)

        try {
          const result = await isPathWithinSandbox(linkPath, WORKDIR)
          expect(result.allowed).toBe(true)
        } finally {
          await rm(tmpFile, { force: true })
        }
      })

      it('denies chain of symlinks eventually escaping sandbox', async () => {
        // Create chain: workdir/link1 -> workdir/link2 -> /etc/passwd
        const link2Path = join(WORKDIR, 'link2')
        await symlink('/etc/passwd', link2Path)
        const link1Path = join(WORKDIR, 'link1')
        await symlink(link2Path, link1Path)

        const result = await isPathWithinSandbox(link1Path, WORKDIR)
        expect(result.allowed).toBe(false)
        expect(result.resolvedPath).toBe(CANONICAL_PASSWD)
      })

      it('handles broken symlinks gracefully', async () => {
        const linkPath = join(WORKDIR, 'broken-link')
        await symlink('/nonexistent/path', linkPath)

        // Should not throw, should treat as the literal path
        const result = await isPathWithinSandbox(linkPath, WORKDIR)
        // The link itself is in workdir, but points outside - denied
        expect(result.allowed).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('handles trailing slashes', async () => {
        const result = await isPathWithinSandbox(WORKDIR + '/', WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('handles double slashes', async () => {
        const result = await isPathWithinSandbox(WORKDIR + '//subdir', WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('handles workdir with trailing slash in check', async () => {
        const result = await isPathWithinSandbox(join(WORKDIR, 'file.txt'), WORKDIR + '/')
        expect(result.allowed).toBe(true)
      })

      it('prevents prefix attack (workdir-evil vs workdir)', async () => {
        // Test that /home/user/project doesn't allow /home/user/project-evil
        // We simulate this with a path that shares the prefix but is different
        // Since we're in /tmp, we need to test outside /tmp for this to matter
        // Use a hypothetical path - the logic should still work
        const fakeWorkdir = '/home/user/project'
        const evilPath = '/home/user/project-evil/file.txt'

        const result = await isPathWithinSandbox(evilPath, fakeWorkdir)
        expect(result.allowed).toBe(false)
      })
    })
  })

  // ===========================================================================
  // extractAbsolutePathsFromCommand()
  // ===========================================================================

  describe('extractAbsolutePathsFromCommand', () => {
    describe('basic extraction', () => {
      it('extracts single absolute path', () => {
        const paths = extractAbsolutePathsFromCommand('cat /etc/passwd')
        expect(paths).toContain('/etc/passwd')
      })

      it('extracts path with ls -la', () => {
        const paths = extractAbsolutePathsFromCommand('ls -la /var/log')
        expect(paths).toContain('/var/log')
      })

      it('extracts multiple paths', () => {
        const paths = extractAbsolutePathsFromCommand('cp /src/file /dst/file')
        expect(paths).toContain('/src/file')
        expect(paths).toContain('/dst/file')
      })

      it('extracts path at start of command', () => {
        const paths = extractAbsolutePathsFromCommand('/usr/bin/node script.js')
        expect(paths).toContain('/usr/bin/node')
      })

      it('deduplicates repeated paths', () => {
        const paths = extractAbsolutePathsFromCommand('cat /etc/passwd && cat /etc/passwd')
        expect(paths.filter((p) => p === '/etc/passwd')).toHaveLength(1)
      })
    })

    describe('tilde expansion', () => {
      const home = homedir()

      it('expands ~/file to home directory', () => {
        const paths = extractAbsolutePathsFromCommand('cat ~/file.txt')
        expect(paths).toContain(join(home, 'file.txt'))
      })

      it('expands ~/ alone', () => {
        const paths = extractAbsolutePathsFromCommand('ls ~/')
        expect(paths).toContain(home)
      })

      it('expands ~/.ssh/config', () => {
        const paths = extractAbsolutePathsFromCommand('cat ~/.ssh/config')
        expect(paths).toContain(join(home, '.ssh/config'))
      })

      it('resolves ~/../ path correctly', () => {
        const home = homedir()
        const paths = extractAbsolutePathsFromCommand('cat ~/../etc/passwd')
        // ~/../etc/passwd with home=/home/user resolves to /home/etc/passwd
        // (one level up from home, into etc)
        const expected = normalize(resolve(home, '../etc/passwd'))
        expect(paths).toContain(expected)
      })

      it('resolves ~/../../etc/passwd to escape home entirely', () => {
        const paths = extractAbsolutePathsFromCommand('cat ~/../../etc/passwd')
        // With home=/home/user: ~/../../etc = /home/user/../../etc = /etc
        expect(paths).toContain(normalize(resolve(home, '../../etc/passwd')))
      })

      it('handles ~ at start of command', () => {
        const paths = extractAbsolutePathsFromCommand('~/bin/script.sh')
        expect(paths).toContain(join(home, 'bin/script.sh'))
      })
    })

    describe('quoted paths', () => {
      it('extracts double-quoted path with spaces', () => {
        const paths = extractAbsolutePathsFromCommand('cat "/path/with spaces/file"')
        expect(paths).toContain('/path/with spaces/file')
      })

      it('extracts single-quoted path with spaces', () => {
        const paths = extractAbsolutePathsFromCommand("cat '/path/with spaces/file'")
        expect(paths).toContain('/path/with spaces/file')
      })

      it('extracts quoted tilde path', () => {
        const home = homedir()
        const paths = extractAbsolutePathsFromCommand('cat "~/Documents/file"')
        expect(paths).toContain(join(home, 'Documents/file'))
      })
    })

    describe('safe paths exclusion', () => {
      it('excludes /dev/null', () => {
        const paths = extractAbsolutePathsFromCommand('command > /dev/null')
        expect(paths).not.toContain('/dev/null')
      })

      it('excludes /dev/stdin', () => {
        const paths = extractAbsolutePathsFromCommand('cat < /dev/stdin')
        expect(paths).not.toContain('/dev/stdin')
      })

      it('excludes /dev/stdout', () => {
        const paths = extractAbsolutePathsFromCommand('echo foo > /dev/stdout')
        expect(paths).not.toContain('/dev/stdout')
      })

      it('excludes /dev/stderr', () => {
        const paths = extractAbsolutePathsFromCommand('2>&1 /dev/stderr')
        expect(paths).not.toContain('/dev/stderr')
      })

      it('excludes /dev/zero', () => {
        const paths = extractAbsolutePathsFromCommand('dd if=/dev/zero')
        expect(paths).not.toContain('/dev/zero')
      })

      it('excludes /dev/random and /dev/urandom', () => {
        const paths = extractAbsolutePathsFromCommand('cat /dev/random /dev/urandom')
        expect(paths).not.toContain('/dev/random')
        expect(paths).not.toContain('/dev/urandom')
      })
    })

    describe('false positive avoidance', () => {
      it('excludes URLs', () => {
        const paths = extractAbsolutePathsFromCommand('curl http://example.com/path')
        expect(paths).not.toContain('/path')
        expect(paths).not.toContain('http://example.com/path')
      })

      it('excludes https URLs', () => {
        const paths = extractAbsolutePathsFromCommand('curl https://example.com/api/v1')
        expect(paths).not.toContain('/api/v1')
      })

      it('excludes regex patterns in grep', () => {
        const paths = extractAbsolutePathsFromCommand("grep '/pattern/' file.txt")
        expect(paths).not.toContain('/pattern/')
      })

      it('excludes complex regex patterns with metacharacters in grep (basic regex)', () => {
        const paths = extractAbsolutePathsFromCommand(
          'grep -n "/api/sessions.*message\\|sessions.*message" src/server/index.ts | head -10',
        )
        expect(paths).not.toContain('/api/sessions.*message\\|sessions.*message')
        expect(paths).toHaveLength(0)
      })

      it('excludes complex regex patterns with metacharacters in grep (extended regex)', () => {
        const paths = extractAbsolutePathsFromCommand(
          "grep -E '/api/sessions.*message|sessions.*message' src/server/index.ts | head -10",
        )
        expect(paths).not.toContain('/api/sessions.*message|sessions.*message')
        expect(paths).toHaveLength(0)
      })

      it('excludes regex patterns with metacharacters but no trailing slash', () => {
        const paths = extractAbsolutePathsFromCommand("grep '/src/.*\\.ts$' file.txt")
        expect(paths).not.toContain('/src/.*\\.ts$')
      })

      it('still extracts legitimate paths with dots, dashes, underscores', () => {
        const paths = extractAbsolutePathsFromCommand('cat "/path/with-dash_underscore.ext"')
        expect(paths).toContain('/path/with-dash_underscore.ext')
      })

      it('excludes regex character classes like [abc] in grep', () => {
        const paths = extractAbsolutePathsFromCommand("grep '/[abc]' file.txt")
        expect(paths).not.toContain('/[abc]')
      })

      it('excludes regex quantifier + in grep', () => {
        const paths = extractAbsolutePathsFromCommand("grep '/foo+' file.txt")
        expect(paths).not.toContain('/foo+')
      })

      it('still extracts paths containing braces {}', () => {
        const paths = extractAbsolutePathsFromCommand("cat '/path/with{braces}/file.txt'")
        expect(paths).toContain('/path/with{braces}/file.txt')
      })

      it('still extracts paths containing pipe |', () => {
        const paths = extractAbsolutePathsFromCommand("cat '/path/with|pipe/file.txt'")
        expect(paths).toContain('/path/with|pipe/file.txt')
      })

      it('still extracts paths containing caret ^', () => {
        const paths = extractAbsolutePathsFromCommand("cat '/path/with^caret/file.txt'")
        expect(paths).toContain('/path/with^caret/file.txt')
      })

      it('still extracts paths containing dollar $', () => {
        const paths = extractAbsolutePathsFromCommand("cat '/path/$variable/file.txt'")
        expect(paths).toContain('/path/$variable/file.txt')
      })

      it('excludes flag values with =', () => {
        const paths = extractAbsolutePathsFromCommand('command --config=/path/to/config')
        // This is ambiguous - we DO want to catch this as it's a real path
        expect(paths).toContain('/path/to/config')
      })

      it('excludes file:// protocol paths from URL context', () => {
        const paths = extractAbsolutePathsFromCommand('xdg-open file:///home/user/doc.pdf')
        // file:// URLs should be detected as paths
        expect(paths).toContain('/home/user/doc.pdf')
      })

      it('excludes API routes in git commit messages', () => {
        const paths = extractAbsolutePathsFromCommand(
          'git add -A && git commit -m "fix: POST /api/auto-update test was spawning real npm install"',
        )
        expect(paths).not.toContain('/api/auto-update')
      })

      it('excludes paths in git commit -am combined flag', () => {
        const paths = extractAbsolutePathsFromCommand('git commit -am "fix: update /api/benchmarks/:id endpoint"')
        expect(paths).not.toContain('/api/benchmarks/:id')
      })

      it('excludes paths in git commit -m messages', () => {
        const paths = extractAbsolutePathsFromCommand(
          'git commit -m "fix: update /api/users endpoint and /api/sessions route"',
        )
        expect(paths).not.toContain('/api/users')
        expect(paths).not.toContain('/api/sessions')
      })

      it('excludes paths in git commit --message long form', () => {
        const paths = extractAbsolutePathsFromCommand('git commit --message "chore: bump /version/file"')
        expect(paths).not.toContain('/version/file')
      })

      it('still extracts real paths from git commands outside -m', () => {
        const paths = extractAbsolutePathsFromCommand('git add /etc/passwd && git commit -m "add config"')
        expect(paths).toContain('/etc/passwd')
        expect(paths).not.toContain('/add')
      })
    })

    describe('cd and directory changes', () => {
      it('extracts path from cd command', () => {
        const paths = extractAbsolutePathsFromCommand('cd /outside/workdir')
        expect(paths).toContain('/outside/workdir')
      })

      it('extracts path from cd && command chain', () => {
        const paths = extractAbsolutePathsFromCommand('cd /etc && cat passwd')
        expect(paths).toContain('/etc')
      })

      it('extracts path from pushd', () => {
        const paths = extractAbsolutePathsFromCommand('pushd /var/log')
        expect(paths).toContain('/var/log')
      })

      it('handles cd + sed -i with regex-like quoted strings', () => {
        const cmd =
          "cd /home/conrad/dev/openfox && sed -i \"s/it('updates mode, phase, running state, and summary while emitting events'/it('updates phase, running state, and summary while emitting events'/\" src/server/session/manager.test.ts"
        const paths = extractAbsolutePathsFromCommand(cmd)
        expect(paths).toContain('/home/conrad/dev/openfox')
        expect(paths).not.toContain('/it(')
      })
    })

    describe('complex commands', () => {
      it('extracts from bash -c subcommand', () => {
        const paths = extractAbsolutePathsFromCommand("bash -c 'cat /etc/passwd'")
        expect(paths).toContain('/etc/passwd')
      })

      it('extracts from sh -c subcommand', () => {
        const paths = extractAbsolutePathsFromCommand('sh -c "ls /var/log"')
        expect(paths).toContain('/var/log')
      })

      it('extracts multiple paths from pipeline', () => {
        const paths = extractAbsolutePathsFromCommand('cat /etc/passwd | grep root > /tmp/result')
        expect(paths).toContain('/etc/passwd')
        expect(paths).toContain('/tmp/result')
      })

      it('extracts from find command', () => {
        const paths = extractAbsolutePathsFromCommand('find /var -name "*.log"')
        expect(paths).toContain('/var')
      })

      it('extracts from tar command', () => {
        const paths = extractAbsolutePathsFromCommand('tar -xf archive.tar -C /opt/app')
        expect(paths).toContain('/opt/app')
      })
    })

    describe('edge cases', () => {
      it('returns empty array for command with no paths', () => {
        const paths = extractAbsolutePathsFromCommand('echo "hello world"')
        expect(paths).toEqual([])
      })

      it('returns empty array for relative paths only', () => {
        const paths = extractAbsolutePathsFromCommand('cat ./file.txt ../other.txt')
        expect(paths).toEqual([])
      })

      it('handles empty command', () => {
        const paths = extractAbsolutePathsFromCommand('')
        expect(paths).toEqual([])
      })

      it('handles command with only whitespace', () => {
        const paths = extractAbsolutePathsFromCommand('   ')
        expect(paths).toEqual([])
      })

      it('handles paths with special characters', () => {
        const paths = extractAbsolutePathsFromCommand('cat "/path/with-dash_underscore.txt"')
        expect(paths).toContain('/path/with-dash_underscore.txt')
      })
    })
  })

  // ===========================================================================
  // checkPathsAccess()
  // ===========================================================================

  describe('checkPathsAccess', () => {
    it('returns needsConfirmation: false for all allowed paths', async () => {
      const paths = [join(WORKDIR, 'file.txt'), join(tmpdir(), 'file.txt')]
      const result = await checkPathsAccess(paths, WORKDIR)
      expect(result.needsConfirmation).toBe(false)
      expect(result.deniedPaths).toEqual([])
    })

    it('returns needsConfirmation: true for denied path', async () => {
      const paths = ['/etc/passwd']
      const result = await checkPathsAccess(paths, WORKDIR)
      expect(result.needsConfirmation).toBe(true)
      expect(result.deniedPaths).toContain(CANONICAL_PASSWD)
    })

    it('returns only denied paths when mix of allowed and denied', async () => {
      const paths = [join(WORKDIR, 'file.txt'), '/etc/passwd', '/var/log/syslog']
      const result = await checkPathsAccess(paths, WORKDIR)
      expect(result.needsConfirmation).toBe(true)
      expect(result.deniedPaths).toHaveLength(2)
      expect(result.deniedPaths).toContain(CANONICAL_PASSWD)
      expect(result.deniedPaths).toContain(CANONICAL_VAR_LOG_SYSLOG)
    })

    it('handles empty paths array', async () => {
      const result = await checkPathsAccess([], WORKDIR)
      expect(result.needsConfirmation).toBe(false)
      expect(result.deniedPaths).toEqual([])
    })

    it('deduplicates denied paths', async () => {
      const paths = ['/etc/passwd', '/etc/passwd']
      const result = await checkPathsAccess(paths, WORKDIR)
      expect(result.deniedPaths).toHaveLength(1)
    })

    describe('sensitive files', () => {
      it('detects .env in workdir as sensitive', async () => {
        const paths = [join(WORKDIR, '.env')]
        const result = await checkPathsAccess(paths, WORKDIR)
        expect(result.needsConfirmation).toBe(true)
        expect(result.sensitivePaths).toContain(join(CANONICAL_WORKDIR, '.env'))
        expect(result.deniedPaths).toEqual([])
      })

      it('detects .env.local in workdir as sensitive', async () => {
        const paths = [join(WORKDIR, '.env.local')]
        const result = await checkPathsAccess(paths, WORKDIR)
        expect(result.needsConfirmation).toBe(true)
        expect(result.sensitivePaths).toContain(join(CANONICAL_WORKDIR, '.env.local'))
      })

      it('detects credentials.json in workdir as sensitive', async () => {
        const paths = [join(WORKDIR, 'credentials.json')]
        const result = await checkPathsAccess(paths, WORKDIR)
        expect(result.needsConfirmation).toBe(true)
        expect(result.sensitivePaths).toContain(join(CANONICAL_WORKDIR, 'credentials.json'))
      })

      it('detects sensitive file outside workdir in both arrays', async () => {
        const paths = ['/etc/.env']
        const result = await checkPathsAccess(paths, WORKDIR)
        expect(result.needsConfirmation).toBe(true)
        expect(result.deniedPaths).toContain(CANONICAL_ETC_ENV)
        expect(result.sensitivePaths).toContain(CANONICAL_ETC_ENV)
      })

      it('does not flag .env.example as sensitive', async () => {
        const paths = [join(WORKDIR, '.env.example')]
        const result = await checkPathsAccess(paths, WORKDIR)
        expect(result.needsConfirmation).toBe(false)
        expect(result.sensitivePaths).toEqual([])
      })

      it('does not flag regular files as sensitive', async () => {
        const paths = [join(WORKDIR, 'index.ts'), join(WORKDIR, 'package.json')]
        const result = await checkPathsAccess(paths, WORKDIR)
        expect(result.needsConfirmation).toBe(false)
        expect(result.sensitivePaths).toEqual([])
        expect(result.deniedPaths).toEqual([])
      })

      it('separates sensitive and denied paths correctly', async () => {
        const paths = [
          join(WORKDIR, '.env'), // sensitive, in workdir
          join(WORKDIR, 'file.ts'), // normal, in workdir
          '/etc/passwd', // denied, not sensitive
        ]
        const result = await checkPathsAccess(paths, WORKDIR)
        expect(result.needsConfirmation).toBe(true)
        expect(result.sensitivePaths).toEqual([join(CANONICAL_WORKDIR, '.env')])
        expect(result.deniedPaths).toEqual([CANONICAL_PASSWD])
      })

      it('includes sensitive file allowed by session in neither array', async () => {
        // First call without session - should need confirmation
        const result1 = await checkPathsAccess([join(WORKDIR, '.env')], WORKDIR)
        expect(result1.needsConfirmation).toBe(true)

        // Note: To test session allowlist, we'd need to add to allowlist first
        // This is tested in the full flow integration tests
      })
    })

    describe('workspace paths', () => {
      it('allows cd to workspace path when workdir is the workspace itself', async () => {
        // Simulate a session in a workspace:
        //   session.workspace = /project/workspaces/my-feature
        //   context.workdir = session.workspace (the effective workdir)
        // Command: cd /project/workspaces/my-feature && npx vitest run some/test.ts
        //
        // The cd path IS the workdir — should be auto-allowed without confirmation.
        const workspaceDir = join(TEST_DIR, 'workspaces', 'my-feature')
        await mkdir(workspaceDir, { recursive: true })

        // Extraction must handle host-shaped paths here (workspaceDir is a real
        // host path), so undo the global linux platform mock for this test.
        mockPlatform(REAL_PLATFORM)
        const command = `cd ${workspaceDir} && npx vitest run src/server/providers/plugins/registry.test.ts 2>&1`
        const extractedPaths = extractAbsolutePathsFromCommand(command)

        // The cd path should be extracted
        expect(extractedPaths).toContain(workspaceDir)

        // Simulate what shell.ts does: check workdir + extracted paths
        const pathsToCheck = [workspaceDir, ...extractedPaths]
        const result = await checkPathsAccess(pathsToCheck, workspaceDir)

        // The workspace path IS the workdir — should be allowed
        expect(result.needsConfirmation).toBe(false)
        expect(result.deniedPaths).toEqual([])
        expect(result.sensitivePaths).toEqual([])
      })

      it('allows paths inside workspace subdirectory', async () => {
        // When workdir is a workspace path, subdirectory paths should be allowed
        const workspaceDir = join(TEST_DIR, 'workspaces', 'subdir-test')
        const subDir = join(workspaceDir, 'packages', 'plugin-a')
        await mkdir(subDir, { recursive: true })

        const result = await checkPathsAccess([subDir], workspaceDir)
        expect(result.needsConfirmation).toBe(false)
        expect(result.deniedPaths).toEqual([])
      })

      it('denies path outside workspace even when workdir is workspace', async () => {
        // When workdir is a workspace path, paths outside should still be denied
        const workspaceDir = join(TEST_DIR, 'workspaces', 'outside-test')
        await mkdir(workspaceDir, { recursive: true })

        const result = await checkPathsAccess(['/etc/passwd'], workspaceDir)
        expect(result.needsConfirmation).toBe(true)
        expect(result.deniedPaths).toContain(CANONICAL_PASSWD)
      })

      it('allows cd to workspace path even when it has trailing slash differences', async () => {
        // Trailing slashes should be normalized away
        const workspaceDir = join(TEST_DIR, 'workspaces', 'trailing-slash')
        await mkdir(workspaceDir, { recursive: true })

        mockPlatform(REAL_PLATFORM)
        const command = `cd ${workspaceDir}/ && npx vitest run test.ts`
        const extractedPaths = extractAbsolutePathsFromCommand(command)

        const pathsToCheck = [workspaceDir, ...extractedPaths]
        const result = await checkPathsAccess(pathsToCheck, workspaceDir)

        expect(result.needsConfirmation).toBe(false)
      })

      it.skipIf(!CAN_SYMLINK)('allows cd to workspace path when command uses resolved canonical path', async () => {
        // If workdir is stored as a realpath-resolved path and the command
        // uses the unresolved path (or vice versa), they should still match
        // because isPathWithinSandbox resolves both sides.
        const workspaceDir = join(TEST_DIR, 'workspaces', 'canonical-test')
        await mkdir(workspaceDir, { recursive: true })
        const canonicalWorkspace = await realpath(workspaceDir)

        // Use a symlink to the workspace (simulates accessing via a different path)
        const symlinkDir = join(TEST_DIR, 'workspaces', 'canonical-link')
        await mkdir(join(TEST_DIR, 'workspaces'), { recursive: true })
        await symlink(workspaceDir, symlinkDir)

        const command = `cd ${symlinkDir} && npx vitest run test.ts`
        const extractedPaths = extractAbsolutePathsFromCommand(command)

        // Workdir is the canonical path, command uses symlink path
        const pathsToCheck = [canonicalWorkspace, ...extractedPaths]
        const result = await checkPathsAccess(pathsToCheck, canonicalWorkspace)

        // Both resolve to the same canonical path — should be allowed
        expect(result.needsConfirmation).toBe(false)
      })
    })
  })

  // ===========================================================================
  // PathAccessDeniedError
  // ===========================================================================

  describe('PathAccessDeniedError', () => {
    it('creates error with correct properties', () => {
      const error = new PathAccessDeniedError(['/etc/passwd'], 'read_file')

      expect(error.paths).toEqual(['/etc/passwd'])
      expect(error.tool).toBe('read_file')
      expect(error.reason).toBe('outside_workdir') // default
      expect(error.name).toBe('PathAccessDeniedError')
      expect(error.message).toContain('/etc/passwd')
      expect(error.message).toContain('User denied')
    })

    it('includes reason in message for sensitive files', () => {
      const error = new PathAccessDeniedError(['.env'], 'read_file', 'sensitive_file')

      expect(error.reason).toBe('sensitive_file')
      expect(error.message).toContain('sensitive files')
      expect(error.message).toContain('.env')
    })

    it('includes all paths in message', () => {
      const error = new PathAccessDeniedError(['/etc/passwd', '/var/log/syslog'], 'run_command')

      expect(error.message).toContain('/etc/passwd')
      expect(error.message).toContain('/var/log/syslog')
    })

    it('is an instance of Error', () => {
      const error = new PathAccessDeniedError([], 'tool')
      expect(error).toBeInstanceOf(Error)
    })
  })

  // ===========================================================================
  // Confirmation flow (providePathConfirmation, cancelPathConfirmation)
  // ===========================================================================

  describe('confirmation flow', () => {
    it('hasPendingPathConfirmation returns false for unknown callId', () => {
      expect(hasPendingPathConfirmation('unknown-id')).toBe(false)
    })

    it('providePathConfirmation returns found: false for unknown callId', () => {
      expect(providePathConfirmation('unknown-id', true)).toEqual({ found: false })
    })

    it('cancelPathConfirmation returns false for unknown callId', () => {
      expect(cancelPathConfirmation('unknown-id', 'reason')).toBe(false)
    })

    it('manages session allowlists with normalization', () => {
      const sessionId = 'allowlist-session'
      addAllowedPath(sessionId, '/tmp/foo/../bar')
      addAllowedPaths(sessionId, ['/etc/hosts', '/var/log/../tmp/test.log'])

      expect(isPathAllowed(sessionId, '/tmp/bar')).toBe(true)
      expect(isPathAllowed(sessionId, '/etc/hosts')).toBe(true)
      expect(isPathAllowed(sessionId, '/var/tmp/test.log')).toBe(true)

      clearAllowedPaths(sessionId)
      expect(isPathAllowed(sessionId, '/tmp/bar')).toBe(false)
    })

    it('registers, approves, and cancels pending confirmations', async () => {
      const approvedPromise = registerPathConfirmation('call-approve', ['/tmp/secret'], 'session-1')
      expect(hasPendingPathConfirmation('call-approve')).toBe(true)
      expect(providePathConfirmation('call-approve', true)).toEqual({
        found: true,
        sessionId: 'session-1',
        approved: true,
      })
      await expect(approvedPromise).resolves.toBe(true)
      expect(hasPendingPathConfirmation('call-approve')).toBe(false)
      expect(isPathAllowed('session-1', '/tmp/secret')).toBe(true)

      const deniedPromise = registerPathConfirmation('call-cancel', ['/tmp/other'], 'session-2')
      const deniedAssertion = expect(deniedPromise).rejects.toThrow('user cancelled')
      expect(cancelPathConfirmation('call-cancel', 'user cancelled')).toBe(true)
      await deniedAssertion
      expect(hasPendingPathConfirmation('call-cancel')).toBe(false)
    })

    it('cancels all pending confirmations for a session', async () => {
      const pendingA = registerPathConfirmation('call-a', ['/tmp/a'], 'session-1')
      const pendingB = registerPathConfirmation('call-b', ['/tmp/b'], 'session-1')
      const pendingC = registerPathConfirmation('call-c', ['/tmp/c'], 'session-2')

      const rejectedA = expect(pendingA).rejects.toThrow('session aborted')
      const rejectedB = expect(pendingB).rejects.toThrow('session aborted')

      expect(cancelPathConfirmationsForSession('session-1', 'session aborted')).toBe(2)
      expect(hasPendingPathConfirmation('call-a')).toBe(false)
      expect(hasPendingPathConfirmation('call-b')).toBe(false)
      expect(hasPendingPathConfirmation('call-c')).toBe(true)
      expect(cancelPathConfirmationsForSession('missing', 'noop')).toBe(0)

      await Promise.all([rejectedA, rejectedB])
      expect(cancelPathConfirmation('call-c', 'cleanup')).toBe(true)
      await expect(pendingC).rejects.toThrow('cleanup')
    })

    it('requests path access, emits confirmation events, and resolves approval/denial', async () => {
      const onEvent = vi.fn()
      const sensitivePath = join(CANONICAL_WORKDIR, '.env')
      const waitForPending = async (callId: string) => {
        for (let attempt = 0; attempt < 20; attempt++) {
          if (hasPendingPathConfirmation(callId)) {
            return
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 5))
        }
      }

      const approvedPromise = requestPathAccess(
        [sensitivePath],
        WORKDIR,
        'session-sensitive',
        'call-sensitive',
        'read_file',
        onEvent,
      )

      await waitForPending('call-sensitive')
      expect(hasPendingPathConfirmation('call-sensitive')).toBe(true)
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chat.path_confirmation',
          payload: expect.objectContaining({
            callId: 'call-sensitive',
            tool: 'read_file',
            paths: [sensitivePath],
            reason: 'sensitive_file',
          }),
        }),
      )
      providePathConfirmation('call-sensitive', true)
      await expect(approvedPromise).resolves.toBeUndefined()
      expect(isPathAllowed('session-sensitive', sensitivePath)).toBe(true)

      const deniedPromise = requestPathAccess(
        ['/etc/.env'],
        WORKDIR,
        'session-both',
        'call-both',
        'run_command',
        onEvent,
      )
      await waitForPending('call-both')
      const deniedAssertion = expect(deniedPromise).rejects.toMatchObject({
        name: 'PathAccessDeniedError',
        reason: 'both',
        tool: 'run_command',
        paths: [CANONICAL_ETC_ENV],
      })
      expect(onEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'chat.path_confirmation',
          payload: expect.objectContaining({ reason: 'both', paths: [CANONICAL_ETC_ENV] }),
        }),
      )
      providePathConfirmation('call-both', false)
      await deniedAssertion
    })

    // Note: Full flow testing requires the interrupt to be thrown and caught,
    // which is integration-level testing. Unit tests verify the API exists.
  })

  // ===========================================================================
  // isSensitivePath()
  // ===========================================================================

  describe('isSensitivePath', () => {
    describe('dotenv files', () => {
      it('detects .env as sensitive', () => {
        expect(isSensitivePath('.env')).toBe(true)
        expect(isSensitivePath('/project/.env')).toBe(true)
        expect(isSensitivePath('/home/user/app/.env')).toBe(true)
      })

      it('detects .env.local as sensitive', () => {
        expect(isSensitivePath('.env.local')).toBe(true)
        expect(isSensitivePath('/project/.env.local')).toBe(true)
      })

      it('detects .env.production as sensitive', () => {
        expect(isSensitivePath('.env.production')).toBe(true)
      })

      it('detects .env.development as sensitive', () => {
        expect(isSensitivePath('.env.development')).toBe(true)
      })

      it('detects .env.development.local as sensitive', () => {
        expect(isSensitivePath('.env.development.local')).toBe(true)
      })

      it('detects .env.test as sensitive', () => {
        expect(isSensitivePath('.env.test')).toBe(true)
      })

      it('does NOT detect .envrc as sensitive (direnv)', () => {
        expect(isSensitivePath('.envrc')).toBe(false)
      })

      it('does NOT detect .environment as sensitive', () => {
        expect(isSensitivePath('.environment')).toBe(false)
      })

      it('does NOT detect env.js as sensitive', () => {
        expect(isSensitivePath('env.js')).toBe(false)
      })

      it('does NOT detect .env-example as sensitive', () => {
        expect(isSensitivePath('.env-example')).toBe(false)
        expect(isSensitivePath('.env.example')).toBe(false)
      })
    })

    describe('credential files', () => {
      it('detects credentials.json as sensitive', () => {
        expect(isSensitivePath('credentials.json')).toBe(true)
        expect(isSensitivePath('/app/credentials.json')).toBe(true)
      })

      it('detects secrets.json as sensitive', () => {
        expect(isSensitivePath('secrets.json')).toBe(true)
      })

      it('detects secret.yaml as sensitive', () => {
        expect(isSensitivePath('secret.yaml')).toBe(true)
        expect(isSensitivePath('secret.yml')).toBe(true)
      })

      it('detects secrets.toml as sensitive', () => {
        expect(isSensitivePath('secrets.toml')).toBe(true)
      })
    })

    describe('private keys', () => {
      it('detects .pem files as sensitive', () => {
        expect(isSensitivePath('private.pem')).toBe(true)
        expect(isSensitivePath('server.pem')).toBe(true)
        expect(isSensitivePath('/ssl/cert.pem')).toBe(true)
      })

      it('detects .key files as sensitive', () => {
        expect(isSensitivePath('private.key')).toBe(true)
        expect(isSensitivePath('server.key')).toBe(true)
      })

      it('detects SSH keys as sensitive', () => {
        expect(isSensitivePath('id_rsa')).toBe(true)
        expect(isSensitivePath('id_rsa.pub')).toBe(true)
        expect(isSensitivePath('id_ed25519')).toBe(true)
        expect(isSensitivePath('id_ecdsa')).toBe(true)
        expect(isSensitivePath('/home/user/.ssh/id_rsa')).toBe(true)
      })
    })

    describe('cloud provider configs', () => {
      it('detects .netrc as sensitive', () => {
        expect(isSensitivePath('.netrc')).toBe(true)
        expect(isSensitivePath('/home/user/.netrc')).toBe(true)
      })
    })

    describe('non-sensitive files', () => {
      it('does NOT detect regular source files as sensitive', () => {
        expect(isSensitivePath('index.ts')).toBe(false)
        expect(isSensitivePath('package.json')).toBe(false)
        expect(isSensitivePath('README.md')).toBe(false)
      })

      it('does NOT detect config files without secrets as sensitive', () => {
        expect(isSensitivePath('tsconfig.json')).toBe(false)
        expect(isSensitivePath('.eslintrc.js')).toBe(false)
        expect(isSensitivePath('vite.config.ts')).toBe(false)
      })
    })
  })

  describe('extractAbsolutePathsFromCommand edge cases', () => {
    it('skips url markers and regex-like slash patterns', () => {
      const command = "curl https://example.com && rg '/foo/' /tmp/project && open file:///etc/passwd"
      const result = extractAbsolutePathsFromCommand(command)

      expect(result).toContain('/etc/passwd')
      expect(result).toContain('/tmp/project')
      expect(result).not.toContain('/foo/')
      expect(result.filter((path) => path.includes('__URL__') || path.includes('__FILEURL__'))).toEqual([])
    })
  })

  // ===========================================================================
  // extractSensitivePathsFromCommand()
  // ===========================================================================

  describe('extractSensitivePathsFromCommand', () => {
    describe('dotenv files', () => {
      it('extracts .env from cat command', () => {
        const paths = extractSensitivePathsFromCommand('cat .env')
        expect(paths).toContain('.env')
      })

      it('extracts .env from source command', () => {
        const paths = extractSensitivePathsFromCommand('source .env')
        expect(paths).toContain('.env')
      })

      it('extracts .env.local from grep command', () => {
        const paths = extractSensitivePathsFromCommand('grep API_KEY .env.local')
        expect(paths).toContain('.env.local')
      })

      it('extracts .env from echo append command', () => {
        const paths = extractSensitivePathsFromCommand('echo "VAR=value" >> .env')
        expect(paths).toContain('.env')
      })

      it('extracts .env from redirection', () => {
        const paths = extractSensitivePathsFromCommand('echo "test" > .env')
        expect(paths).toContain('.env')
      })

      it('extracts .env.production from complex command', () => {
        const paths = extractSensitivePathsFromCommand('cp .env.production /tmp/backup')
        expect(paths).toContain('.env.production')
      })

      it('extracts multiple .env files from command', () => {
        const paths = extractSensitivePathsFromCommand('cat .env .env.local')
        expect(paths).toContain('.env')
        expect(paths).toContain('.env.local')
      })

      it('extracts .env in subdirectory path', () => {
        const paths = extractSensitivePathsFromCommand('cat config/.env')
        expect(paths).toContain('config/.env')
      })
    })

    describe('credential files', () => {
      it('extracts credentials.json', () => {
        const paths = extractSensitivePathsFromCommand('cat credentials.json')
        expect(paths).toContain('credentials.json')
      })

      it('extracts secrets.yaml', () => {
        const paths = extractSensitivePathsFromCommand('kubectl apply -f secrets.yaml')
        expect(paths).toContain('secrets.yaml')
      })
    })

    describe('private keys', () => {
      it('extracts .pem files', () => {
        const paths = extractSensitivePathsFromCommand('openssl x509 -in cert.pem')
        expect(paths).toContain('cert.pem')
      })

      it('extracts SSH keys', () => {
        // This would be caught by extractAbsolutePathsFromCommand for tilde
        // But if just id_rsa is referenced
        const paths2 = extractSensitivePathsFromCommand('cat id_rsa')
        expect(paths2).toContain('id_rsa')
      })
    })

    describe('quoted paths', () => {
      it('extracts .env from double-quoted path', () => {
        const paths = extractSensitivePathsFromCommand('cat ".env"')
        expect(paths).toContain('.env')
      })

      it('extracts .env from single-quoted path', () => {
        const paths = extractSensitivePathsFromCommand("cat '.env.local'")
        expect(paths).toContain('.env.local')
      })

      it('extracts .env with spaces in path', () => {
        const paths = extractSensitivePathsFromCommand('cat "my project/.env"')
        expect(paths).toContain('my project/.env')
      })
    })

    describe('does not extract', () => {
      it('does not extract non-sensitive files', () => {
        const paths = extractSensitivePathsFromCommand('cat index.ts package.json')
        expect(paths).toEqual([])
      })

      it('does not extract .envrc', () => {
        const paths = extractSensitivePathsFromCommand('cat .envrc')
        expect(paths).toEqual([])
      })

      it('returns empty for command with no paths', () => {
        const paths = extractSensitivePathsFromCommand('echo "hello"')
        expect(paths).toEqual([])
      })

      it('returns empty for empty command', () => {
        const paths = extractSensitivePathsFromCommand('')
        expect(paths).toEqual([])
      })
    })

    describe('deduplication', () => {
      it('deduplicates repeated sensitive paths', () => {
        const paths = extractSensitivePathsFromCommand('cat .env && cat .env')
        expect(paths.filter((p: string) => p === '.env')).toHaveLength(1)
      })
    })
  })

  // ===========================================================================
  // False positive regression tests
  // ===========================================================================

  describe('false positive regression', () => {
    it('does not extract / from comment lines starting with //', () => {
      const paths = extractAbsolutePathsFromCommand('// @vitest-environment happy-dom\n')
      expect(paths).not.toContain('/')
      expect(paths).not.toContain('//')
    })

    it('does not extract false paths from heredoc with JSX content', () => {
      const command = [
        "cd /home/conrad/dev/openfox && cat > /tmp/test-minimal.tsx << 'EOF'",
        '// @vitest-environment happy-dom',
        "import { describe, expect, it } from 'vitest'",
        "import { render, screen } from '@testing-library/react'",
        "import '@testing-library/jest-dom/vitest'",
        'function SimpleComponent() { return <div>Hello</div> }',
        "describe('minimal', () => {",
        "  it('renders', () => {",
        '    render(<SimpleComponent />)',
        "    expect(screen.getByText('Hello')).toBeInTheDocument()",
        '  })',
        '})',
        'EOF',
        'npx vitest run /tmp/test-minimal.tsx 2>&1 | tail -15',
      ].join('\n')

      const paths = extractAbsolutePathsFromCommand(command)

      // Should find the legitimate paths
      expect(paths).toContain('/home/conrad/dev/openfox')
      expect(paths).toContain('/tmp/test-minimal.tsx')

      // Should NOT contain bare root or empty string
      expect(paths).not.toContain('/')
      expect(paths).not.toContain('')
    })

    it('does not trigger path confirmation for heredoc command with allowed paths', async () => {
      const command = [
        "cat > /tmp/test-minimal.tsx << 'EOF'",
        '// @vitest-environment happy-dom',
        "import { describe, expect, it } from 'vitest'",
        "import { render, screen } from '@testing-library/react'",
        "import '@testing-library/jest-dom/vitest'",
        'function SimpleComponent() { return <div>Hello</div> }',
        'EOF',
        'npx vitest run /tmp/test-minimal.tsx 2>&1 | tail -15',
      ].join('\n')

      const commandPaths = extractAbsolutePathsFromCommand(command)
      const sensitivePaths = extractSensitivePathsFromCommand(command)
      const pathsToCheck = [WORKDIR, ...commandPaths, ...sensitivePaths]

      const result = await checkPathsAccess(pathsToCheck, WORKDIR)

      // All paths should be allowed (workdir + /tmp paths)
      expect(result.needsConfirmation).toBe(false)
      expect(result.deniedPaths).toEqual([])
      expect(result.sensitivePaths).toEqual([])
    })
  })

  // ===========================================================================
  // extractGitNoVerify()
  // ===========================================================================

  describe('extractGitNoVerify', () => {
    it('detects --no-verify in git commit', () => {
      expect(extractGitNoVerify('git commit --no-verify -m "fix"')).toBe(true)
    })

    it('detects --no-verify in git push', () => {
      expect(extractGitNoVerify('git push --no-verify origin main')).toBe(true)
    })

    it('detects -n shorthand in git rebase', () => {
      expect(extractGitNoVerify('git rebase -n HEAD~3')).toBe(true)
    })

    it('does not detect --no-verify in non-git commands', () => {
      expect(extractGitNoVerify('curl --no-verify https://example.com')).toBe(false)
    })

    it('does not detect --no-verify when git is not followed by a subcommand', () => {
      expect(extractGitNoVerify('git --no-verify something')).toBe(false)
    })

    it('does not detect -n flag from subsequent commands in a chain', () => {
      expect(extractGitNoVerify('git status; echo -n test')).toBe(false)
      expect(extractGitNoVerify('git status && echo -n test')).toBe(false)
    })

    it('detects -n flag in env-prefixed git commands', () => {
      expect(extractGitNoVerify("ENV=true git commit -n 'lol'")).toBe(true)
    })
  })

  // ===========================================================================
  // git --no-verify confirmation (even in dangerous mode)
  // ===========================================================================

  describe('git --no-verify confirmation', () => {
    it('requests confirmation for git commit --no-verify even in dangerous mode', async () => {
      const onEvent = vi.fn()
      const waitForPending = async (callId: string) => {
        for (let attempt = 0; attempt < 20; attempt++) {
          if (hasPendingPathConfirmation(callId)) return
          await new Promise<void>((resolve) => setTimeout(resolve, 5))
        }
      }

      const promise = requestPathAccess(
        [WORKDIR],
        WORKDIR,
        'session-git',
        'call-git',
        'run_command',
        onEvent,
        'dangerous',
        'git commit --no-verify -m "skip hooks"',
      )

      await waitForPending('call-git')
      expect(hasPendingPathConfirmation('call-git')).toBe(true)
      expect(onEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'chat.path_confirmation',
          payload: expect.objectContaining({
            callId: 'call-git',
            tool: 'run_command',
            paths: ['git --no-verify detected'],
            reason: 'git_no_verify',
          }),
        }),
      )
      providePathConfirmation('call-git', true)
      await expect(promise).resolves.toBeUndefined()
    })

    it('rejects with clear error message when user denies git --no-verify', async () => {
      const onEvent = vi.fn()
      const waitForPending = async (callId: string) => {
        for (let attempt = 0; attempt < 20; attempt++) {
          if (hasPendingPathConfirmation(callId)) return
          await new Promise<void>((resolve) => setTimeout(resolve, 5))
        }
      }

      const promise = requestPathAccess(
        [WORKDIR],
        WORKDIR,
        'session-deny',
        'call-deny',
        'run_command',
        onEvent,
        'dangerous',
        'git push --no-verify',
      )

      await waitForPending('call-deny')
      providePathConfirmation('call-deny', false)
      await expect(promise).rejects.toThrow('must not use --no-verify')
      await expect(promise).rejects.toMatchObject({
        name: 'PathAccessDeniedError',
        reason: 'git_no_verify',
        tool: 'run_command',
      })
    })

    it('does not trigger confirmation when git command has no --no-verify', async () => {
      const onEvent = vi.fn()

      const promise = requestPathAccess(
        [WORKDIR],
        WORKDIR,
        'session-normal',
        'call-normal',
        'run_command',
        onEvent,
        'dangerous',
        'git commit -m "normal commit"',
      )

      await new Promise<void>((resolve) => setTimeout(resolve, 50))
      expect(hasPendingPathConfirmation('call-normal')).toBe(false)
      expect(onEvent).not.toHaveBeenCalled()
      await expect(promise).resolves.toBeUndefined()
    })
  })

  // ===========================================================================
  // Sub-agent path access (deny by default, allow in dangerous mode)
  // ===========================================================================

  describe('sub-agent path access', () => {
    it('denies outside workdir immediately when isSubAgent and normal mode', async () => {
      const onEvent = vi.fn()
      const promise = requestPathAccess(
        ['/etc/passwd'],
        WORKDIR,
        'session-sub-normal',
        'call-sub-normal',
        'read_file',
        onEvent,
        'normal',
        undefined,
        true, // isSubAgent
      )

      await expect(promise).rejects.toMatchObject({
        name: 'PathAccessDeniedError',
        reason: 'outside_workdir',
        tool: 'read_file',
        paths: [CANONICAL_PASSWD],
      })
      // Should NOT have emitted any confirmation event
      expect(onEvent).not.toHaveBeenCalled()
      // Should NOT have registered a pending confirmation
      expect(hasPendingPathConfirmation('call-sub-normal')).toBe(false)
    })

    it('denies sensitive file immediately when isSubAgent and normal mode', async () => {
      const onEvent = vi.fn()
      const promise = requestPathAccess(
        [join(WORKDIR, '.env')],
        WORKDIR,
        'session-sub-sensitive',
        'call-sub-sensitive',
        'read_file',
        onEvent,
        'normal',
        undefined,
        true, // isSubAgent
      )

      await expect(promise).rejects.toMatchObject({
        name: 'PathAccessDeniedError',
        reason: 'sensitive_file',
        tool: 'read_file',
      })
      expect(onEvent).not.toHaveBeenCalled()
      expect(hasPendingPathConfirmation('call-sub-sensitive')).toBe(false)
    })

    it('denies mixed paths immediately when isSubAgent and normal mode', async () => {
      const onEvent = vi.fn()
      const promise = requestPathAccess(
        ['/etc/passwd', join(WORKDIR, '.env')],
        WORKDIR,
        'session-sub-mixed',
        'call-sub-mixed',
        'read_file',
        onEvent,
        'normal',
        undefined,
        true, // isSubAgent
      )

      await expect(promise).rejects.toMatchObject({
        name: 'PathAccessDeniedError',
        reason: 'both',
        tool: 'read_file',
      })
      expect(onEvent).not.toHaveBeenCalled()
      expect(hasPendingPathConfirmation('call-sub-mixed')).toBe(false)
    })

    it('allows outside workdir when isSubAgent and dangerous mode', async () => {
      const onEvent = vi.fn()
      const promise = requestPathAccess(
        ['/etc/passwd'],
        WORKDIR,
        'session-sub-dangerous',
        'call-sub-dangerous',
        'read_file',
        onEvent,
        'dangerous',
        undefined,
        true, // isSubAgent
      )

      await expect(promise).resolves.toBeUndefined()
      // Should NOT have emitted any confirmation event
      expect(onEvent).not.toHaveBeenCalled()
      // Path should be in allowlist
      expect(isPathAllowed('session-sub-dangerous', CANONICAL_PASSWD)).toBe(true)
      // Cleanup
      clearAllowedPaths('session-sub-dangerous')
    })

    it('allows paths inside workdir when isSubAgent (no confirmation needed)', async () => {
      const onEvent = vi.fn()
      const promise = requestPathAccess(
        [join(WORKDIR, 'file.txt')],
        WORKDIR,
        'session-sub-inside',
        'call-sub-inside',
        'read_file',
        onEvent,
        'normal',
        undefined,
        true, // isSubAgent
      )

      await expect(promise).resolves.toBeUndefined()
      expect(onEvent).not.toHaveBeenCalled()
    })

    it('auto-approves git --no-verify when isSubAgent and dangerous mode', async () => {
      const onEvent = vi.fn()
      const promise = requestPathAccess(
        [WORKDIR],
        WORKDIR,
        'session-sub-git-dangerous',
        'call-sub-git-dangerous',
        'run_command',
        onEvent,
        'dangerous',
        'git commit --no-verify -m "skip"',
        true, // isSubAgent
      )

      // Should auto-approve without prompting
      await expect(promise).resolves.toBeUndefined()
      expect(onEvent).not.toHaveBeenCalled()
      expect(hasPendingPathConfirmation('call-sub-git-dangerous')).toBe(false)
    })

    it('skips git --no-verify check entirely when isSubAgent (paths win)', async () => {
      // For sub-agents, the git --no-verify and dangerous command checks are
      // skipped entirely. Only path access is evaluated. If paths are within
      // the sandbox, the operation proceeds regardless of --no-verify.
      const onEvent = vi.fn()
      const promise = requestPathAccess(
        [WORKDIR],
        WORKDIR,
        'session-sub-git-normal',
        'call-sub-git-normal',
        'run_command',
        onEvent,
        'normal',
        'git commit --no-verify -m "skip"',
        true, // isSubAgent
      )

      // WORKDIR is inside /tmp (allowed root), so paths are fine → allowed
      await expect(promise).resolves.toBeUndefined()
      expect(onEvent).not.toHaveBeenCalled()
      expect(hasPendingPathConfirmation('call-sub-git-normal')).toBe(false)
    })

    it('denies outside path even with harmless command when isSubAgent and normal mode', async () => {
      // Sub-agent in normal mode: outside paths are denied even if the
      // command itself is harmless. The path check dominates.
      const onEvent = vi.fn()
      const promise = requestPathAccess(
        ['/etc/passwd'],
        WORKDIR,
        'session-sub-cmd-normal',
        'call-sub-cmd-normal',
        'read_file',
        onEvent,
        'normal',
        'echo hello',
        true, // isSubAgent
      )

      await expect(promise).rejects.toMatchObject({
        name: 'PathAccessDeniedError',
        reason: 'outside_workdir',
        tool: 'read_file',
      })
      expect(onEvent).not.toHaveBeenCalled()
      expect(hasPendingPathConfirmation('call-sub-cmd-normal')).toBe(false)
    })
  })
})

// Standalone: no fs fixtures needed, so it runs on any host (the main suite's
// fixtures assume Unix paths like /etc/passwd).
describe('extractAbsolutePathsFromCommand on Windows (cmd.exe shell)', () => {
  beforeEach(() => {
    mockPlatform('win32')
  })

  afterEach(() => {
    mockPlatform(REAL_PLATFORM)
  })

  it('treats /tokens as cmd switches, not paths', () => {
    expect(extractAbsolutePathsFromCommand('dir /s /b')).toEqual([])
    expect(extractAbsolutePathsFromCommand('findstr /i /n "error" log.txt')).toEqual([])
  })

  it('extracts drive-letter absolute paths (the pre-fix security gap)', () => {
    const paths = extractAbsolutePathsFromCommand('type C:\\secrets\\creds.txt')
    expect(paths).toEqual(['C:\\secrets\\creds.txt'])
  })

  it('extracts drive-letter paths written with forward slashes', () => {
    const paths = extractAbsolutePathsFromCommand('type C:/secrets/creds.txt')
    expect(paths).toHaveLength(1)
    // normalize() separator conversion depends on the host platform
    expect(paths[0]).toMatch(/^C:[\\/]secrets[\\/]creds\.txt$/)
  })

  it('extracts quoted drive-letter paths with spaces', () => {
    const paths = extractAbsolutePathsFromCommand('type "C:\\path with spaces\\file.txt"')
    expect(paths).toEqual(['C:\\path with spaces\\file.txt'])
  })

  it('extracts the path but not the switches in a mixed command', () => {
    expect(extractAbsolutePathsFromCommand('dir /s C:\\projects')).toEqual(['C:\\projects'])
  })

  it('deduplicates and handles multiple drive paths', () => {
    const paths = extractAbsolutePathsFromCommand('copy D:\\a.txt E:\\b.txt & type D:\\a.txt')
    expect(paths).toEqual(['D:\\a.txt', 'E:\\b.txt'])
  })

  it('does not extract unix-style quoted strings', () => {
    expect(extractAbsolutePathsFromCommand('echo "/etc/passwd"')).toEqual([])
  })

  it('still expands tilde paths', () => {
    const paths = extractAbsolutePathsFromCommand('cat ~/file.txt')
    expect(paths).toContain(join(homedir(), 'file.txt'))
  })
})
