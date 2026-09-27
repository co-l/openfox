export type PermissionEffect = 'ALLOW' | 'DENY' | 'ASK'

export type PermissionScope = 'global' | 'project'

export interface PermissionRule {
  effect: PermissionEffect
  tool: string
  pattern?: string | undefined
  description?: string | undefined
}

/**
 * A rule as the registry hands it out: always carries an `id`, so the UI and
 * the REST API address a rule by identity instead of by position in the list.
 * `id` is optional in the on-disk file — the registry backfills hand-written
 * rules on load and persists the ids on the next save.
 */
export interface StoredPermissionRule extends PermissionRule {
  id: string
}

/** Rules shipped by OpenFox (server/permissions/defaults.ts) carry a `default-` id, kept on edit. */
export function isDefaultRule(rule: StoredPermissionRule): boolean {
  return rule.id.startsWith('default-')
}

export interface ScopedPermissionRule extends StoredPermissionRule {
  scope: PermissionScope
}

export interface PermissionConfig {
  version: 1
  rules: StoredPermissionRule[]
}

/**
 * Tools whose call carries a path or command target. Only these support a
 * `pattern` and the full ALLOW/DENY/ASK range — every other tool has nothing
 * to match against, so it accepts DENY-only rules with no pattern.
 *
 * Single source of truth: the Zod schema, the rule matcher, the tool gate and
 * the settings UI all derive their behaviour from this list.
 */
export const PATTERN_TOOLS = ['read_file', 'write_file', 'edit_file', 'run_command'] as const

/** Pattern tools whose target is a command line rather than a filesystem path. */
export const COMMAND_TOOLS = ['run_command'] as const

const PATTERN_TOOL_SET: ReadonlySet<string> = new Set<string>(PATTERN_TOOLS)
const COMMAND_TOOL_SET: ReadonlySet<string> = new Set<string>(COMMAND_TOOLS)

/** True when rules for this tool can carry a pattern and any effect. */
export function isPatternTool(tool: string): boolean {
  return PATTERN_TOOL_SET.has(tool)
}

/** True when this tool's rule pattern matches a command line. */
export function isCommandTool(tool: string): boolean {
  return COMMAND_TOOL_SET.has(tool)
}

/** True when this tool's rule pattern matches a filesystem path. */
export function isPathTool(tool: string): boolean {
  return PATTERN_TOOL_SET.has(tool) && !COMMAND_TOOL_SET.has(tool)
}

/** Why a path or rule was granted for a session. */
export type SessionGrantReason = 'outside_workdir' | 'sensitive_file' | 'both' | 'rule_ask' | 'dangerous_auto'

/**
 * An approved path. The grant is per path, not per tool: once approved, the
 * path skips the sandbox and sensitive-file prompts for every tool.
 * `tool` and `reason` say what triggered the approval, not what it is limited to.
 */
export interface SessionPathGrant {
  path: string
  grantedAt: number
  tool?: string
  reason?: SessionGrantReason
}

/** An ALLOW rule promoted from an ASK rule; limited to `tool`, covers everything `pattern` matches. */
export type SessionRuleGrant = PermissionRule & { grantedAt: number }

/** What "Allow for this session" granted, for one session (in-memory, not persisted). */
export interface SessionGrants {
  sessionId: string
  paths: SessionPathGrant[]
  rules: SessionRuleGrant[]
}
