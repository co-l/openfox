export type PermissionEffect = 'ALLOW' | 'DENY' | 'ASK'

export type PermissionScope = 'global' | 'project'

export interface PermissionRule {
  effect: PermissionEffect
  tool: string
  pattern?: string | undefined
  description?: string | undefined
}

export interface ScopedPermissionRule extends PermissionRule {
  scope: PermissionScope
}

export interface PermissionConfig {
  version: 1
  rules: PermissionRule[]
}
