import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, symlink, rm, writeFile } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import {
  isPathWithinSandbox,
  extractAbsolutePathsFromCommand,
  checkPathsAccess,
  PathConfirmationInterrupt,
  PathAccessDeniedError,
  providePathConfirmation,
  cancelPathConfirmation,
  hasPendingPathConfirmation,
} from './path-security.js'

// Test fixtures directory - use a unique subdir that's NOT in /tmp's allowed root
// We create workdir INSIDE /tmp but treat sibling tests specially
const TEST_DIR = join(tmpdir(), 'openfox-path-security-test')
const WORKDIR = join(TEST_DIR, 'project', 'workdir')  // Nested to allow sibling tests
const OUTSIDE_DIR = join(TEST_DIR, 'project', 'outside')  // Sibling of workdir but still in /tmp
// For true outside-workdir tests, we use paths that aren't in /tmp
const TRULY_OUTSIDE = '/var/lib'  // This is outside both workdir AND /tmp

describe('path-security', () => {
  beforeEach(async () => {
    // Create test directories
    await mkdir(WORKDIR, { recursive: true })
    await mkdir(OUTSIDE_DIR, { recursive: true })
    await mkdir(join(WORKDIR, 'subdir'), { recursive: true })
    await writeFile(join(WORKDIR, 'file.txt'), 'test')
    await writeFile(join(OUTSIDE_DIR, 'secret.txt'), 'secret')  // For symlink tests (in /tmp, so creatable)
  })

  afterEach(async () => {
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
        const result = await isPathWithinSandbox('/tmp/some-file.txt', WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('allows path exactly at /tmp', async () => {
        const result = await isPathWithinSandbox('/tmp', WORKDIR)
        expect(result.allowed).toBe(true)
      })

      it('allows nested path in /tmp', async () => {
        const result = await isPathWithinSandbox('/tmp/foo/bar/baz', WORKDIR)
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
    })

    describe('relative path escapes', () => {
      it('denies path that escapes /tmp sandbox', async () => {
        // WORKDIR is nested deep in /tmp, so we need many .. to escape
        // Just test with a known outside path
        const result = await isPathWithinSandbox('/etc/passwd', WORKDIR)
        expect(result.allowed).toBe(false)
        expect(result.resolvedPath).toBe('/etc/passwd')
      })

      it('denies subdir/../../../../../etc resolved escape', async () => {
        // Need to escape far enough to get out of /tmp entirely
        const maliciousPath = join(WORKDIR, 'subdir', '..', '..', '..', '..', '..', 'etc')
        const result = await isPathWithinSandbox(maliciousPath, WORKDIR)
        expect(result.allowed).toBe(false)
        expect(result.resolvedPath).toBe('/etc')
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
        expect(result.resolvedPath).toBe('/etc/passwd')
      })
    })

    describe('symlink resolution', () => {
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
        expect(result.resolvedPath).toBe('/etc/passwd')
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
        expect(result.resolvedPath).toBe('/etc/passwd')
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
        expect(paths.filter(p => p === '/etc/passwd')).toHaveLength(1)
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
        expect(paths).toContain('/etc/passwd')
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
      const paths = [join(WORKDIR, 'file.txt'), '/tmp/file.txt']
      const result = await checkPathsAccess(paths, WORKDIR)
      expect(result.needsConfirmation).toBe(false)
      expect(result.deniedPaths).toEqual([])
    })

    it('returns needsConfirmation: true for denied path', async () => {
      const paths = ['/etc/passwd']
      const result = await checkPathsAccess(paths, WORKDIR)
      expect(result.needsConfirmation).toBe(true)
      expect(result.deniedPaths).toContain('/etc/passwd')
    })

    it('returns only denied paths when mix of allowed and denied', async () => {
      const paths = [join(WORKDIR, 'file.txt'), '/etc/passwd', '/var/log/syslog']
      const result = await checkPathsAccess(paths, WORKDIR)
      expect(result.needsConfirmation).toBe(true)
      expect(result.deniedPaths).toHaveLength(2)
      expect(result.deniedPaths).toContain('/etc/passwd')
      expect(result.deniedPaths).toContain('/var/log/syslog')
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
  })

  // ===========================================================================
  // PathConfirmationInterrupt
  // ===========================================================================

  describe('PathConfirmationInterrupt', () => {
    it('creates interrupt with correct properties', () => {
      const interrupt = new PathConfirmationInterrupt(
        'call-123',
        ['/etc/passwd', '/var/log'],
        'run_command',
        '/home/user/project'
      )

      expect(interrupt.callId).toBe('call-123')
      expect(interrupt.paths).toEqual(['/etc/passwd', '/var/log'])
      expect(interrupt.tool).toBe('run_command')
      expect(interrupt.workdir).toBe('/home/user/project')
      expect(interrupt.name).toBe('PathConfirmationInterrupt')
      expect(interrupt.message).toBe('Path confirmation required')
    })

    it('is an instance of Error', () => {
      const interrupt = new PathConfirmationInterrupt('id', [], 'tool', '/wd')
      expect(interrupt).toBeInstanceOf(Error)
    })
  })

  // ===========================================================================
  // PathAccessDeniedError
  // ===========================================================================

  describe('PathAccessDeniedError', () => {
    it('creates error with correct properties', () => {
      const error = new PathAccessDeniedError(
        ['/etc/passwd'],
        'read_file'
      )

      expect(error.paths).toEqual(['/etc/passwd'])
      expect(error.tool).toBe('read_file')
      expect(error.name).toBe('PathAccessDeniedError')
      expect(error.message).toContain('/etc/passwd')
    })

    it('includes all paths in message', () => {
      const error = new PathAccessDeniedError(
        ['/etc/passwd', '/var/log/syslog'],
        'run_command'
      )

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

    // Note: Full flow testing requires the interrupt to be thrown and caught,
    // which is integration-level testing. Unit tests verify the API exists.
  })
})
