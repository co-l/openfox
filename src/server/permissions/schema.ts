import { z } from 'zod'

export type { PermissionEffect, PermissionRule, PermissionConfig } from '../../shared/permissions.js'

export const permissionEffectSchema = z.enum(['ALLOW', 'DENY', 'ASK'])

export const permissionRuleSchema = z
  .object({
    effect: permissionEffectSchema,
    tool: z.string().min(1),
    pattern: z.string().optional(),
    description: z.string().optional(),
  })
  .strict()

export const permissionConfigSchema = z
  .object({
    version: z.literal(1),
    rules: z.array(permissionRuleSchema),
  })
  .strict()

import type { PermissionConfig } from '../../shared/permissions.js'

export const EMPTY_CONFIG: PermissionConfig = { version: 1, rules: [] }
