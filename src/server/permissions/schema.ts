import { z } from 'zod'
import { isPatternTool } from '../../shared/permissions.js'

export type {
  PermissionEffect,
  PermissionRule,
  StoredPermissionRule,
  PermissionConfig,
} from '../../shared/permissions.js'

export const permissionEffectSchema = z.enum(['ALLOW', 'DENY', 'ASK'])

const ruleShape = {
  effect: permissionEffectSchema,
  tool: z.string().min(1),
  pattern: z.string().optional(),
  description: z.string().optional(),
}

/** Non-pattern tools have no target to match, so they only accept DENY with no pattern. */
function refineToolSupport(rule: { effect: string; tool: string; pattern?: string | undefined }, ctx: z.RefinementCtx) {
  if (isPatternTool(rule.tool)) return
  if (rule.effect !== 'DENY') {
    ctx.addIssue({
      code: 'custom',
      message: `Tool "${rule.tool}" only supports DENY rules (no path/command target to match patterns against)`,
      path: ['effect'],
    })
  }
  if (rule.pattern !== undefined) {
    ctx.addIssue({
      code: 'custom',
      message: `Tool "${rule.tool}" does not support patterns (no path/command target)`,
      path: ['pattern'],
    })
  }
}

/** A rule as written by a user (no id yet) — the body of an "add rule" request. */
export const permissionRuleInputSchema = z.object(ruleShape).strict().superRefine(refineToolSupport)

/**
 * A rule as stored on disk. `id` is optional so hand-written `permissions.json`
 * files stay valid; the registry backfills a generated id on load.
 */
export const permissionRuleSchema = z
  .object({ ...ruleShape, id: z.string().min(1).optional() })
  .strict()
  .superRefine(refineToolSupport)

export const permissionConfigSchema = z
  .object({
    version: z.literal(1),
    rules: z.array(permissionRuleSchema),
  })
  .strict()

import type { PermissionConfig } from '../../shared/permissions.js'

export const EMPTY_CONFIG: PermissionConfig = { version: 1, rules: [] }
