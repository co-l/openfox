import { mkdir, rm, writeFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('file watcher initialization', () => {
  let testDir = ''

  afterEach(async () => {
    vi.resetModules()
    vi.doUnmock('node:fs')
    vi.doUnmock('./history.utils.js')
    vi.doUnmock('./history.snapshot.js')
    if (testDir) {
      await rm(testDir, { recursive: true, force: true })
    }
  })

  it('waits for gitignore rules before tracking changes', async () => {
    testDir = join(tmpdir(), `openfox-watcher-init-${Date.now()}`)
    await mkdir(join(testDir, 'node_modules'), { recursive: true })
    await writeFile(join(testDir, '.gitignore'), 'node_modules/\n')

    const createSnapshotSpy = vi.fn(async (filePath: string, workdir: string, changeType: 'create' | 'modify' | 'delete') => ({
      success: true,
      snapshotData: {
        path: filePath.replace(`${workdir}/`, ''),
        timestamp: new Date().toISOString(),
        changeType,
        hashBefore: null,
        hashAfter: null,
        content: null,
      },
    }))

    vi.doMock('./history.utils.js', () => ({
      loadGitignore: () => new Promise<string[]>(resolve => setTimeout(() => resolve(['node_modules/']), 200)),
      isPathExcluded: (relativePath: string, patterns: string[]) => patterns.includes('node_modules/') && relativePath.startsWith('node_modules/'),
    }))

    vi.doMock('./history.snapshot.js', () => ({
      createSnapshot: createSnapshotSpy,
    }))

    const { FileWatcher } = await import('./history.watcher.js')
    const watcher = new FileWatcher(testDir, join(testDir, '.openfox', 'history'), [], 50)
    const snapshotCallback = vi.fn()
    watcher.onSnapshot = snapshotCallback

    await watcher.start()
    await writeFile(join(testDir, 'node_modules', 'race.txt'), 'should stay ignored')
    await new Promise(resolve => setTimeout(resolve, 150))

    watcher.stop()

    expect(createSnapshotSpy).not.toHaveBeenCalled()
    expect(snapshotCallback).not.toHaveBeenCalled()
  })

  it('passes ignore patterns to fs.watch', async () => {
    testDir = join(tmpdir(), `openfox-watcher-ignore-${Date.now()}`)
    await mkdir(testDir, { recursive: true })

    const watchSpy = vi.fn(() => {
      const watcher = new EventEmitter()
      return Object.assign(watcher, { close: vi.fn() })
    })

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
      return {
        ...actual,
        watch: watchSpy,
      }
    })

    vi.doMock('./history.utils.js', () => ({
      loadGitignore: vi.fn(async () => ['node_modules/**', 'dist/**']),
      isPathExcluded: vi.fn(() => false),
    }))

    const { FileWatcher } = await import('./history.watcher.js')
    const watcher = new FileWatcher(testDir, join(testDir, '.openfox', 'history'), ['coverage/**'])

    await watcher.start()
    watcher.stop()

    expect(watchSpy).toHaveBeenCalledTimes(1)
    expect(watchSpy).toHaveBeenCalledWith(
      testDir,
      expect.objectContaining({
        recursive: true,
        ignore: expect.arrayContaining(['.openfox/**', 'coverage/**', 'node_modules/**', 'dist/**']),
      }),
      expect.any(Function)
    )
  })

  it('handles watcher error events without throwing', async () => {
    testDir = join(tmpdir(), `openfox-watcher-error-${Date.now()}`)
    await mkdir(testDir, { recursive: true })

    const closeSpy = vi.fn()
    const fakeWatcher = Object.assign(new EventEmitter(), { close: closeSpy })
    const watchSpy = vi.fn(() => fakeWatcher)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
      return {
        ...actual,
        watch: watchSpy,
      }
    })

    vi.doMock('./history.utils.js', () => ({
      loadGitignore: vi.fn(async () => []),
      isPathExcluded: vi.fn(() => false),
    }))

    const { FileWatcher } = await import('./history.watcher.js')
    const watcher = new FileWatcher(testDir, join(testDir, '.openfox', 'history'))

    await watcher.start()

    expect(() => {
      fakeWatcher.emit('error', Object.assign(new Error('watch limit reached'), { code: 'ENOSPC' }))
    }).not.toThrow()

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
    watcher.stop()
  })

  it('notifies watcher error callbacks', async () => {
    testDir = join(tmpdir(), `openfox-watcher-onerror-${Date.now()}`)
    await mkdir(testDir, { recursive: true })

    const fakeWatcher = Object.assign(new EventEmitter(), { close: vi.fn() })

    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
      return {
        ...actual,
        watch: vi.fn(() => fakeWatcher),
      }
    })

    vi.doMock('./history.utils.js', () => ({
      loadGitignore: vi.fn(async () => []),
      isPathExcluded: vi.fn(() => false),
    }))

    const { FileWatcher } = await import('./history.watcher.js')
    const watcher = new FileWatcher(testDir, join(testDir, '.openfox', 'history'))
    const onError = vi.fn()
    watcher.onError = onError

    await watcher.start()

    fakeWatcher.emit('error', new Error('child should exit'))

    expect(onError).toHaveBeenCalledTimes(1)

    watcher.stop()
  })
})
