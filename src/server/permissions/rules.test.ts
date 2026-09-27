import { describe, it, expect } from 'vitest'
import { evaluateRules, evaluateRulesWithMatch, matchPathPattern, matchCommandPattern } from './rules.js'
import type { PermissionRule } from './schema.js'

describe('matchPathPattern', () => {
  it('matches ** across directory boundaries', () => {
    expect(matchPathPattern('/ubiquity/**', '/ubiquity/a/b.yaml')).toBe(true)
    expect(matchPathPattern('/ubiquity/**', '/ubiquity/a/b/c.yaml')).toBe(true)
    expect(matchPathPattern('/ubiquity/**', '/ubiquity')).toBe(true)
  })

  it('does not match outside the pattern', () => {
    expect(matchPathPattern('/ubiquity/**', '/other/a.yaml')).toBe(false)
    expect(matchPathPattern('/ubiquity/**', '/ubiquity-other/x')).toBe(false)
  })

  it('matches * within one segment', () => {
    expect(matchPathPattern('/ubiquity/*.yaml', '/ubiquity/a.yaml')).toBe(true)
    expect(matchPathPattern('/ubiquity/*.yaml', '/ubiquity/sub/a.yaml')).toBe(false)
  })

  it('empty/undefined pattern matches everything', () => {
    expect(matchPathPattern(undefined, '/any/path')).toBe(true)
    expect(matchPathPattern('', '/any/path')).toBe(true)
  })

  it('trailing slash normalization', () => {
    expect(matchPathPattern('/ubiquity/**', '/ubiquity/')).toBe(true)
  })
})

describe('matchCommandPattern', () => {
  it('matches rm -rf with any argument', () => {
    expect(matchCommandPattern('rm -rf *', 'rm -rf /tmp/x')).toBe(true)
    expect(matchCommandPattern('rm -rf *', 'rm -rf /home/user/foo')).toBe(true)
  })

  it('does not match rm -rf alone (needs arg)', () => {
    expect(matchCommandPattern('rm -rf *', 'rm -rf')).toBe(false)
  })

  it('does not match different command', () => {
    expect(matchCommandPattern('rm -rf *', 'ls -la')).toBe(false)
  })

  it('exact command match', () => {
    expect(matchCommandPattern('sudo apt update', 'sudo apt update')).toBe(true)
    expect(matchCommandPattern('sudo apt update', 'sudo apt upgrade')).toBe(false)
  })

  it('empty/undefined pattern matches everything', () => {
    expect(matchCommandPattern(undefined, 'any command here')).toBe(true)
    expect(matchCommandPattern('', 'any command here')).toBe(true)
  })

  it('matches as glob where spaces are literal', () => {
    expect(matchCommandPattern('git push *', 'git push origin main')).toBe(true)
    expect(matchCommandPattern('git push *', 'git commit -m "x"')).toBe(false)
  })
})

describe('evaluateRules', () => {
  const rule = (effect: PermissionRule['effect'], tool: string, pattern?: string): PermissionRule => ({
    effect,
    tool,
    ...(pattern !== undefined ? { pattern } : {}),
  })

  it('returns null when no rules match', () => {
    expect(evaluateRules([], 'read_file', '/path')).toBeNull()
    expect(evaluateRules([rule('DENY', 'write_file', '/x')], 'read_file', '/path')).toBeNull()
  })

  it('returns null when tool name does not match', () => {
    expect(evaluateRules([rule('DENY', 'run_command', 'rm *')], 'read_file', '/path')).toBeNull()
  })

  it('returns the effect when a single rule matches', () => {
    expect(evaluateRules([rule('DENY', 'read_file', '/secret/**')], 'read_file', '/secret/key.pem')).toBe('DENY')
    expect(evaluateRules([rule('ALLOW', 'read_file', '/ubiquity/**')], 'read_file', '/ubiquity/a.yaml')).toBe('ALLOW')
    expect(evaluateRules([rule('ASK', 'write_file', '**/.env*')], 'write_file', '/proj/.env')).toBe('ASK')
  })

  it('rule without pattern matches all calls to that tool', () => {
    expect(evaluateRules([rule('ALLOW', 'read_file')], 'read_file', '/any/path')).toBe('ALLOW')
    expect(evaluateRules([rule('DENY', 'run_command')], 'run_command', 'any command')).toBe('DENY')
  })

  it('DENY wins over ALLOW (deny > allow > ask)', () => {
    const rules = [rule('ALLOW', 'read_file', '/ubiquity/**'), rule('DENY', 'read_file', '/ubiquity/secrets/**')]
    expect(evaluateRules(rules, 'read_file', '/ubiquity/secrets/key.pem')).toBe('DENY')
  })

  it('DENY wins over ASK', () => {
    const rules = [rule('ASK', 'read_file', '/x/**'), rule('DENY', 'read_file', '/x/**')]
    expect(evaluateRules(rules, 'read_file', '/x/a')).toBe('DENY')
  })

  it('ALLOW wins over ASK', () => {
    const rules = [rule('ASK', 'read_file', '/x/**'), rule('ALLOW', 'read_file', '/x/**')]
    expect(evaluateRules(rules, 'read_file', '/x/a')).toBe('ALLOW')
  })

  it('global ALLOW + project DENY → DENY (deny always wins regardless of source)', () => {
    const globalRules = [rule('ALLOW', 'read_file', '/ubiquity/**')]
    const projectRules = [rule('DENY', 'read_file', '/ubiquity/secrets/**')]
    const merged = [...globalRules, ...projectRules]
    expect(evaluateRules(merged, 'read_file', '/ubiquity/secrets/key.pem')).toBe('DENY')
  })

  it('global DENY + project ALLOW → DENY', () => {
    const globalRules = [rule('DENY', 'run_command', 'rm -rf *')]
    const projectRules = [rule('ALLOW', 'run_command', 'rm -rf /tmp/*')]
    const merged = [...globalRules, ...projectRules]
    expect(evaluateRules(merged, 'run_command', 'rm -rf /tmp/x')).toBe('DENY')
  })

  it('project ALLOW + global ASK → ALLOW', () => {
    const globalRules = [rule('ASK', 'read_file', '/x')]
    const projectRules = [rule('ALLOW', 'read_file', '/x')]
    const merged = [...globalRules, ...projectRules]
    expect(evaluateRules(merged, 'read_file', '/x')).toBe('ALLOW')
  })

  it('first defined wins when multiple rules of same effect match', () => {
    const rules = [rule('ALLOW', 'read_file', '/a'), rule('ALLOW', 'read_file', '/a/b')]
    expect(evaluateRules(rules, 'read_file', '/a/b')).toBe('ALLOW')
  })

  it('command patterns: DENY rm -rf * blocks the command', () => {
    const rules = [rule('DENY', 'run_command', 'rm -rf *')]
    expect(evaluateRules(rules, 'run_command', 'rm -rf /home/user')).toBe('DENY')
  })

  it('command patterns: ALLOW does not block', () => {
    const rules = [rule('ALLOW', 'run_command', 'git push *')]
    expect(evaluateRules(rules, 'run_command', 'git push origin main')).toBe('ALLOW')
  })
})

describe('evaluateRulesWithMatch', () => {
  const rule = (effect: PermissionRule['effect'], tool: string, pattern?: string): PermissionRule => ({
    effect,
    tool,
    ...(pattern !== undefined ? { pattern } : {}),
  })

  it('returns null effect and null rule when no rules match', () => {
    const result = evaluateRulesWithMatch([], 'read_file', '/path')
    expect(result.effect).toBeNull()
    expect(result.rule).toBeNull()
  })

  it('returns the matched rule for DENY', () => {
    const r = rule('DENY', 'read_file', '/secret/**')
    const result = evaluateRulesWithMatch([r], 'read_file', '/secret/key.pem')
    expect(result.effect).toBe('DENY')
    expect(result.rule).toBe(r)
  })

  it('returns the matched rule for ASK', () => {
    const r = rule('ASK', 'run_command', 'terragrunt destroy *')
    const result = evaluateRulesWithMatch([r], 'run_command', 'terragrunt destroy -auto-approve')
    expect(result.effect).toBe('ASK')
    expect(result.rule).toBe(r)
  })

  it('returns the matched rule for ALLOW', () => {
    const r = rule('ALLOW', 'read_file', '/x/**')
    const result = evaluateRulesWithMatch([r], 'read_file', '/x/a')
    expect(result.effect).toBe('ALLOW')
    expect(result.rule).toBe(r)
  })

  it('DENY rule wins and is returned over ALLOW', () => {
    const allowRule = rule('ALLOW', 'read_file', '/x/**')
    const denyRule = rule('DENY', 'read_file', '/x/secrets/**')
    const result = evaluateRulesWithMatch([allowRule, denyRule], 'read_file', '/x/secrets/key')
    expect(result.effect).toBe('DENY')
    expect(result.rule).toBe(denyRule)
  })

  it('returns the highest-precedence rule even if a lower one appears later', () => {
    const askRule = rule('ASK', 'read_file', '/x/**')
    const denyRule = rule('DENY', 'read_file', '/x/**')
    const result = evaluateRulesWithMatch([askRule, denyRule], 'read_file', '/x/a')
    expect(result.effect).toBe('DENY')
    expect(result.rule).toBe(denyRule)
  })
})
