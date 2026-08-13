import { z } from 'zod'

export type { PermissionEffect, PermissionRule, PermissionConfig } from '../../shared/permissions.js'

export const permissionEffectSchema = z.enum(['ALLOW', 'DENY', 'ASK'])

const PATTERN_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'run_command'])

export const permissionRuleSchema = z
  .object({
    effect: permissionEffectSchema,
    tool: z.string().min(1),
    pattern: z.string().optional(),
    description: z.string().optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (!PATTERN_TOOLS.has(rule.tool)) {
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
  })

export const permissionConfigSchema = z
  .object({
    version: z.literal(1),
    rules: z.array(permissionRuleSchema),
  })
  .strict()

import type { PermissionConfig } from '../../shared/permissions.js'

export const EMPTY_CONFIG: PermissionConfig = { version: 1, rules: [] }
