import { minimatch } from 'minimatch'
import type { PermissionEffect, PermissionRule } from './schema.js'

export type { PermissionRule } from './schema.js'

const PRECEDENCE: Record<PermissionEffect, number> = { DENY: 3, ALLOW: 2, ASK: 1 }

export function matchPathPattern(pattern: string | undefined, path: string): boolean {
  if (!pattern) return true
  const normalizedPath = path.replace(/\/+$/, '') || '/'
  if (minimatch(normalizedPath, pattern, { dot: true })) return true
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3)
    return normalizedPath === base
  }
  if (pattern.endsWith('/**/')) {
    const base = pattern.slice(0, -4)
    return normalizedPath === base
  }
  return false
}

function globToRegex(pattern: string): RegExp {
  let regex = '^'
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]!
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*'
        i += 2
      } else {
        regex += '.*'
        i += 1
      }
    } else if (c === '?') {
      regex += '.'
      i += 1
    } else if ('.+^${}()|[]\\'.includes(c)) {
      regex += '\\' + c
      i += 1
    } else {
      regex += c
      i += 1
    }
  }
  return new RegExp(regex + '$')
}

export function matchCommandPattern(pattern: string | undefined, command: string): boolean {
  if (!pattern) return true
  return globToRegex(pattern).test(command)
}

function isPathTool(tool: string): boolean {
  return tool === 'read_file' || tool === 'write_file' || tool === 'edit_file'
}

function matchesRule(rule: PermissionRule, tool: string, target: string): boolean {
  if (rule.tool !== tool) return false
  const pattern = rule.pattern
  if (isPathTool(tool)) return matchPathPattern(pattern, target)
  if (tool === 'run_command') return matchCommandPattern(pattern, target)
  return matchPathPattern(pattern, target)
}

export function evaluateRules(rules: PermissionRule[], tool: string, target: string): PermissionEffect | null {
  return evaluateRulesWithMatch(rules, tool, target).effect
}

export interface RuleMatchResult {
  effect: PermissionEffect | null
  rule: PermissionRule | null
}

export function evaluateRulesWithMatch(rules: PermissionRule[], tool: string, target: string): RuleMatchResult {
  let best: PermissionEffect | null = null
  let bestPrecedence = 0
  let bestRule: PermissionRule | null = null

  for (const rule of rules) {
    if (!matchesRule(rule, tool, target)) continue
    const precedence = PRECEDENCE[rule.effect]
    if (precedence > bestPrecedence) {
      best = rule.effect
      bestPrecedence = precedence
      bestRule = rule
    }
  }

  return { effect: best, rule: bestRule }
}
