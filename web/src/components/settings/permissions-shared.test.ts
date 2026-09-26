import { describe, it, expect } from 'vitest'
import type { ScopedPermissionRule } from '@shared/permissions.js'
import { filterRules } from './permissions-shared'

const rule = (over: Partial<ScopedPermissionRule>): ScopedPermissionRule => ({
  id: 'r',
  effect: 'ASK',
  tool: 'run_command',
  scope: 'global',
  ...over,
})

const rules = [
  rule({ id: 'default-deny-key-file-read_file', effect: 'DENY', tool: 'read_file', pattern: '**/*.{pem,key}' }),
  rule({ id: 'default-ask-git-push-f', pattern: 'git push -f*', description: 'Ask before force-pushing' }),
  rule({ id: 'a1b2', effect: 'ALLOW', tool: 'run_command', pattern: 'npm test', scope: 'project' }),
]

describe('filterRules', () => {
  it('splits user rules from shipped defaults', () => {
    const { mine, defaults } = filterRules(rules, '', [])
    expect(mine.map((r) => r.id)).toEqual(['a1b2'])
    expect(defaults.map((r) => r.id)).toEqual(['default-deny-key-file-read_file', 'default-ask-git-push-f'])
  })

  it('searches tool, pattern and description, case-insensitively', () => {
    expect(filterRules(rules, 'FORCE', []).defaults.map((r) => r.id)).toEqual(['default-ask-git-push-f'])
    expect(filterRules(rules, 'pem', []).defaults.map((r) => r.id)).toEqual(['default-deny-key-file-read_file'])
    expect(filterRules(rules, 'read_file', []).mine).toEqual([])
  })

  it('keeps only the selected effects, all of them when none is selected', () => {
    const { mine, defaults } = filterRules(rules, '', ['DENY', 'ALLOW'])
    expect([...mine, ...defaults].map((r) => r.effect).sort()).toEqual(['ALLOW', 'DENY'])
  })
})
