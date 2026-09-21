import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeLiveEditContext } from './edit-file-preview.js'

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'edit-preview-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const FILE = ['line one', 'line two', 'line three', 'const x = 1;', 'line five', 'line six', 'line seven'].join('\n')

describe('computeLiveEditContext', () => {
  it('returns undefined when there is no arguments fragment', async () => {
    await withTempDir(async (dir) => {
      expect(await computeLiveEditContext(undefined, dir, new Map())).toBeUndefined()
      expect(await computeLiveEditContext('', dir, new Map())).toBeUndefined()
    })
  })

  it('returns undefined when the path or edit strings are missing', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'a.ts'), FILE)
      expect(await computeLiveEditContext('{"path":"a.ts"', dir, new Map())).toBeUndefined()
    })
  })

  it('returns undefined when the file does not exist', async () => {
    await withTempDir(async (dir) => {
      const result = await computeLiveEditContext(
        '{"path":"missing.ts","old_string":"x","new_string":"y"}',
        dir,
        new Map(),
      )
      expect(result).toBeUndefined()
    })
  })

  it('computes regions with surrounding context for a matching edit', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'a.ts'), FILE)
      const regions = await computeLiveEditContext(
        '{"path":"a.ts","old_string":"const x = 1;","new_string":"const x = 2;"}',
        dir,
        new Map(),
      )
      expect(regions).toBeDefined()
      expect(regions!.length).toBe(1)
      const region = regions![0]!
      expect(region.oldContent).toBe('const x = 1;')
      expect(region.newContent).toBe('const x = 2;')
      expect(region.beforeContext.at(-1)?.content).toBe('line three')
      expect(region.afterContext[0]?.content).toBe('line five')
    })
  })

  it('returns undefined when the edit does not match the file', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'a.ts'), FILE)
      const regions = await computeLiveEditContext(
        '{"path":"a.ts","old_string":"not present","new_string":"y"}',
        dir,
        new Map(),
      )
      expect(regions).toBeUndefined()
    })
  })

  it('reads the file only once per path', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'a.ts'), FILE)
      const cache = new Map<string, string>()
      const first = await computeLiveEditContext(
        '{"path":"a.ts","old_string":"const x = 1;","new_string":"a"}',
        dir,
        cache,
      )
      // Simulate the file changing on disk — the cache must shield the second call.
      await writeFile(join(dir, 'a.ts'), 'changed content')
      const second = await computeLiveEditContext(
        '{"path":"a.ts","old_string":"changed content","new_string":"b"}',
        dir,
        cache,
      )
      expect(first).toBeDefined()
      // Cached content is the original, so "changed content" does not match.
      expect(second).toBeUndefined()
    })
  })

  it('supports replace_all producing merged regions', async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, 'src'))
      const content = ['a = 1', 'b = 2', 'a = 3', 'c = 4', 'a = 5', 'd = 6'].join('\n')
      await writeFile(join(dir, 'src', 'x.ts'), content)
      const regions = await computeLiveEditContext(
        '{"path":"src/x.ts","old_string":"a = ","new_string":"b = ","replace_all":true}',
        dir,
        new Map(),
      )
      expect(regions).toBeDefined()
      expect(regions!.length).toBeGreaterThanOrEqual(1)
      expect(regions![0]!.edits.length).toBe(3)
    })
  })
})
