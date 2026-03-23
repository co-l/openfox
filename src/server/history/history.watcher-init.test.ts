import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('file watcher initialization', () => {
  let testDir = ''

  afterEach(async () => {
    vi.resetModules()
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
})
