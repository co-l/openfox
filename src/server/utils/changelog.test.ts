/**
 * Changelog Util Tests
 *
 * Covers helpers in src/server/utils/changelog.ts.
 */

import { describe, it, expect } from 'vitest'
import { parseVersionHeading, trimChangelog } from './changelog.js'

const FULL = `# Changelog

## 2.0.115 - 2026-08-11

### Features

- Bullet 115

## 2.0.114 - 2026-08-10

### Bug Fixes

- Bullet 114

## [2.0.0] - 2026-06-21

### Features

- Ancient
`

describe('parseVersionHeading', () => {
  it('parses a plain version heading', () => {
    expect(parseVersionHeading('## 2.0.115 - 2026-08-11')).toBe('2.0.115')
  })

  it('parses a bracketed version heading', () => {
    expect(parseVersionHeading('## [2.0.0] - 2026-06-21')).toBe('2.0.0')
  })

  it('returns null for non-version headings', () => {
    expect(parseVersionHeading('## Something Else')).toBeNull()
    expect(parseVersionHeading('# Changelog')).toBeNull()
    expect(parseVersionHeading('### Features')).toBeNull()
  })
})

describe('trimChangelog', () => {
  it('returns the full content when no since is given', () => {
    expect(trimChangelog(FULL)).toBe(FULL)
  })

  it('returns the full content when since is invalid', () => {
    expect(trimChangelog(FULL, 'not-a-version')).toBe(FULL)
    expect(trimChangelog(FULL, '')).toBe(FULL)
  })

  it('keeps only sections newer than since', () => {
    const trimmed = trimChangelog(FULL, '2.0.113')
    expect(trimmed).toContain('## 2.0.115 - 2026-08-11')
    expect(trimmed).toContain('## 2.0.114 - 2026-08-10')
    expect(trimmed).toContain('- Bullet 115')
    expect(trimmed).toContain('- Bullet 114')
    expect(trimmed).not.toContain('## [2.0.0] - 2026-06-21')
    expect(trimmed).not.toContain('Ancient')
  })

  it('includes every section when skipping many versions', () => {
    const trimmed = trimChangelog(FULL, '1.0.0')
    expect(trimmed).toContain('## 2.0.115 - 2026-08-11')
    expect(trimmed).toContain('## 2.0.114 - 2026-08-10')
    expect(trimmed).toContain('## [2.0.0] - 2026-06-21')
    expect(trimmed).toContain('Ancient')
  })

  it('excludes the section matching since itself', () => {
    const trimmed = trimChangelog(FULL, '2.0.115')
    expect(trimmed).not.toContain('Bullet 115')
    expect(trimmed).toContain('# Changelog')
  })

  it('keeps the title when nothing is newer', () => {
    expect(trimChangelog(FULL, '9.9.9')).toBe('# Changelog')
  })

  it('keeps non-version headings instead of silently dropping them', () => {
    const withExtras = `${FULL}\n## v2.0.116 - 2026-08-12\n\n### Features\n\n- Next\n\n## Unreleased\n\n### Features\n\n- Coming soon\n`
    const trimmed = trimChangelog(withExtras, '2.0.115')
    expect(trimmed).toContain('## v2.0.116 - 2026-08-12')
    expect(trimmed).toContain('- Next')
    expect(trimmed).toContain('## Unreleased')
    expect(trimmed).toContain('- Coming soon')
  })
})
