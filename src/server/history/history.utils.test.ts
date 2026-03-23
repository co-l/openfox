import { describe, expect, it } from 'vitest'
import { isPathExcluded } from './history.utils.js'

describe('history utils', () => {
  it('treats gitignored directories as excluded descendants', () => {
    expect(isPathExcluded('node_modules/test.js', ['node_modules/'])).toBe(true)
    expect(isPathExcluded('packages/app/node_modules/test.js', ['node_modules/'])).toBe(true)
  })

  it('matches basename patterns in nested directories', () => {
    expect(isPathExcluded('debug.log', ['*.log'])).toBe(true)
    expect(isPathExcluded('src/debug.log', ['*.log'])).toBe(true)
  })

  it('supports negated patterns with last-match-wins semantics', () => {
    expect(isPathExcluded('logs/keep.log', ['*.log', '!logs/keep.log'])).toBe(false)
    expect(isPathExcluded('logs/drop.log', ['*.log', '!logs/keep.log'])).toBe(true)
  })
})
