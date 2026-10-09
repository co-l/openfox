// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { ansiToReact, clearAnsiCacheForTest, getAnsiCacheBytesForTest, setAnsiCacheMaxBytesForTest } from './ansiParser'

afterEach(() => {
  clearAnsiCacheForTest()
  setAnsiCacheMaxBytesForTest()
})

describe('ansiToReact', () => {
  it('returns a node for colored text', () => {
    const node = ansiToReact('[32mok[0m\nline2')
    expect(node).toBeDefined()
  })

  it('memoizes per text: repeated calls share the same node and skip parsing', () => {
    const text = '[31merror[0m\n[32mok[0m'
    const first = ansiToReact(text)
    const second = ansiToReact(text)
    // Same node instance => the parser was not re-run for the repeat.
    expect(second).toBe(first)
  })

  it('re-rendering an unchanged chunk list parses each chunk exactly once', () => {
    const chunks = ['a', 'b', 'a', 'c', 'b', 'a']
    // First "render"
    const render1 = chunks.map((c) => ansiToReact(c))
    // Second "render" with the same chunks (streaming flush re-render)
    const render2 = chunks.map((c) => ansiToReact(c))
    // Every repeated chunk returns the exact same node => no re-parse.
    for (let i = 0; i < chunks.length; i++) {
      expect(render2[i]).toBe(render1[i])
    }
    // Distinct contents are distinct nodes.
    expect(render1[0]).not.toBe(render1[1])
  })

  it('evicts oldest entries past the byte budget', () => {
    setAnsiCacheMaxBytesForTest(100)
    // Three 40-byte entries: after the third, the first must be evicted.
    const a = 'a'.repeat(40)
    const b = 'b'.repeat(40)
    const c = 'c'.repeat(40)
    const nodeA = ansiToReact(a)
    ansiToReact(b)
    ansiToReact(c)

    expect(getAnsiCacheBytesForTest()).toBeLessThanOrEqual(100)
    // The evicted entry parses again on demand (fresh node instance).
    const nodeA2 = ansiToReact(a)
    expect(nodeA2).not.toBe(nodeA)
  })

  it('measures the byte budget in real bytes, not UTF-16 code units', () => {
    setAnsiCacheMaxBytesForTest(24)
    // Ten CJK characters are 10 UTF-16 code units but 30 UTF-8 bytes, so the
    // next insert must evict them (code-unit counting would see only 11 and
    // keep both entries).
    const cjk = '文'.repeat(10)
    const node1 = ansiToReact(cjk)
    ansiToReact('x')

    expect(getAnsiCacheBytesForTest()).toBe(1)
    const node2 = ansiToReact(cjk)
    expect(node2).not.toBe(node1)
  })
})
