import { describe, it, expect } from 'vitest'
import { sanitizeToolSchema } from './schema-sanitizer.js'

describe('sanitizeToolSchema', () => {
  it('returns valid default schema for non-object inputs', () => {
    expect(sanitizeToolSchema(null)).toEqual({ type: 'object', properties: {} })
    expect(sanitizeToolSchema(undefined)).toEqual({ type: 'object', properties: {} })
    expect(sanitizeToolSchema('string')).toEqual({ type: 'object', properties: {} })
    expect(sanitizeToolSchema([])).toEqual({ type: 'object', properties: {} })
  })

  it('strips unsupported JSON schema keywords and additionalProperties', () => {
    const input = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'http://example.com/schema.json',
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', patternProperties: {} },
      },
    }
    expect(sanitizeToolSchema(input)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
    })
  })

  it('strips null and undefined values such as default: null', () => {
    const input = {
      type: 'object',
      properties: {
        expand: { type: 'string', default: null },
        include: { type: 'string', default: null },
        count: { type: 'number', default: 10 },
      },
    }
    expect(sanitizeToolSchema(input)).toEqual({
      type: 'object',
      properties: {
        expand: { type: 'string' },
        include: { type: 'string' },
        count: { type: 'number', default: 10 },
      },
    })
  })

  it('converts const to enum', () => {
    const input = {
      type: 'object',
      properties: {
        mode: { const: 'exact' },
      },
    }
    expect(sanitizeToolSchema(input)).toEqual({
      type: 'object',
      properties: {
        mode: { enum: ['exact'] },
      },
    })
  })

  it('normalizes empty or missing array items to { type: "string" }', () => {
    const input = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: {} },
        labels: { type: 'array' },
      },
    }
    expect(sanitizeToolSchema(input)).toEqual({
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        labels: { type: 'array', items: { type: 'string' } },
      },
    })
  })

  it('ensures type: object always has a properties map', () => {
    const input = {
      type: 'object',
      properties: {
        env: { type: 'object' },
      },
    }
    expect(sanitizeToolSchema(input)).toEqual({
      type: 'object',
      properties: {
        env: { type: 'object', properties: {} },
      },
    })
  })

  it('normalizes string property values in properties map', () => {
    const input = {
      type: 'object',
      properties: {
        env: 'object',
        name: 'string',
      },
    }
    expect(sanitizeToolSchema(input)).toEqual({
      type: 'object',
      properties: {
        env: { type: 'object', properties: {} },
        name: { type: 'string' },
      },
    })
  })

  it('sanitizes real Jira MCP tool schema containing additionalProperties and null defaults', () => {
    const jiraSchema = {
      type: 'object',
      properties: {
        issue_key: {
          description: "Jira issue key (e.g., 'PROJ-123')",
          type: 'string',
        },
        expand: {
          default: null,
          description: '(Optional) Fields to expand',
          type: 'string',
        },
        properties: {
          description: '(Optional) A comma-separated list of issue properties to return',
          default: null,
          type: 'string',
        },
        comment_limit: {
          default: 10,
          maximum: 100,
          minimum: 0,
          type: 'integer',
        },
      },
      required: ['issue_key'],
      additionalProperties: false,
    }

    const sanitized = sanitizeToolSchema(jiraSchema)

    expect(sanitized).toEqual({
      type: 'object',
      properties: {
        issue_key: {
          description: "Jira issue key (e.g., 'PROJ-123')",
          type: 'string',
        },
        expand: {
          description: '(Optional) Fields to expand',
          type: 'string',
        },
        props: {
          description: '(Optional) A comma-separated list of issue properties to return',
          type: 'string',
        },
        comment_limit: {
          default: 10,
          maximum: 100,
          minimum: 0,
          type: 'integer',
        },
      },
      required: ['issue_key'],
    })
    expect(sanitized).not.toHaveProperty('additionalProperties')
  })

  it('recursively sanitizes nested properties and oneOf/anyOf branches', () => {
    const input = {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            subOptions: {
              oneOf: [{ const: 'auto' }, { type: 'array', items: {} }],
            },
          },
        },
      },
    }
    expect(sanitizeToolSchema(input)).toEqual({
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            subOptions: {
              oneOf: [{ enum: ['auto'] }, { type: 'array', items: { type: 'string' } }],
            },
          },
        },
      },
    })
  })
})
