import { describe, it, expect } from 'vitest'
import { permissionRuleSchema, permissionConfigSchema, type PermissionEffect } from './schema.js'

describe('permissionRuleSchema', () => {
  it('accepts a full rule with all fields', () => {
    const rule = {
      effect: 'DENY',
      tool: 'run_command',
      pattern: 'rm -rf *',
      description: 'Never delete recursively',
    }
    expect(permissionRuleSchema.parse(rule)).toEqual(rule)
  })

  it('accepts a rule without pattern (matches all calls to that tool)', () => {
    const rule = { effect: 'ALLOW', tool: 'read_file' }
    const parsed = permissionRuleSchema.parse(rule)
    expect(parsed.effect).toBe('ALLOW')
    expect(parsed.tool).toBe('read_file')
    expect(parsed.pattern).toBeUndefined()
  })

  it('accepts a rule without description', () => {
    const rule = { effect: 'ASK', tool: 'write_file', pattern: '**/.env*' }
    const parsed = permissionRuleSchema.parse(rule)
    expect(parsed.description).toBeUndefined()
  })

  it('rejects unknown effect', () => {
    expect(() => permissionRuleSchema.parse({ effect: 'ALWAYS', tool: 'read_file' })).toThrow()
    expect(() => permissionRuleSchema.parse({ effect: 'allow', tool: 'read_file' })).toThrow()
    expect(() => permissionRuleSchema.parse({ effect: 'MAYBE', tool: 'read_file' })).toThrow()
  })

  it('accepts unknown tool names (forward-compat with MCP/future tools) without pattern', () => {
    const rule = { effect: 'DENY', tool: 'mcp_custom_tool' }
    expect(permissionRuleSchema.parse(rule)).toEqual(rule)
  })

  it('rejects non-DENY effect on non-pattern tools (web_fetch)', () => {
    expect(() => permissionRuleSchema.parse({ effect: 'ALLOW', tool: 'web_fetch' })).toThrow()
    expect(() => permissionRuleSchema.parse({ effect: 'ASK', tool: 'web_fetch' })).toThrow()
  })

  it('rejects pattern on non-pattern tools (web_fetch)', () => {
    expect(() => permissionRuleSchema.parse({ effect: 'DENY', tool: 'web_fetch', pattern: '*' })).toThrow()
  })

  it('accepts DENY without pattern on non-pattern tools', () => {
    const rule = { effect: 'DENY', tool: 'web_fetch' }
    expect(permissionRuleSchema.parse(rule)).toEqual(rule)
  })

  it('rejects missing effect', () => {
    expect(() => permissionRuleSchema.parse({ tool: 'read_file' })).toThrow()
  })

  it('rejects missing tool', () => {
    expect(() => permissionRuleSchema.parse({ effect: 'DENY' })).toThrow()
  })

  it('rejects empty tool string', () => {
    expect(() => permissionRuleSchema.parse({ effect: 'DENY', tool: '' })).toThrow()
  })

  it('rejects non-string pattern', () => {
    expect(() => permissionRuleSchema.parse({ effect: 'DENY', tool: 'read_file', pattern: 123 })).toThrow()
  })

  it('rejects unknown extra fields', () => {
    expect(() =>
      permissionRuleSchema.parse({ effect: 'DENY', tool: 'read_file', pattern: '*', unknown: 'x' }),
    ).toThrow()
  })
})

describe('permissionConfigSchema', () => {
  it('accepts a config with version and rules', () => {
    const config = {
      version: 1,
      rules: [
        { effect: 'DENY', tool: 'run_command', pattern: 'rm -rf *' },
        { effect: 'ALLOW', tool: 'read_file', pattern: '/ubiquity/**' },
      ],
    }
    expect(permissionConfigSchema.parse(config)).toEqual(config)
  })

  it('accepts a config with empty rules array', () => {
    const config = { version: 1, rules: [] }
    expect(permissionConfigSchema.parse(config)).toEqual(config)
  })

  it('rejects missing version', () => {
    expect(() => permissionConfigSchema.parse({ rules: [] })).toThrow()
  })

  it('rejects unknown version', () => {
    expect(() => permissionConfigSchema.parse({ version: 2, rules: [] })).toThrow()
  })

  it('rejects unknown extra fields at top level', () => {
    expect(() => permissionConfigSchema.parse({ version: 1, rules: [], extra: 'x' })).toThrow()
  })
})

describe('PermissionEffect type', () => {
  it('has exactly 3 values: ALLOW, DENY, ASK', () => {
    const effects: PermissionEffect[] = ['ALLOW', 'DENY', 'ASK']
    expect(effects).toHaveLength(3)
    expect(effects).not.toContain('ALWAYS')
  })
})
