import { describe, it, expect } from 'vitest'
import { sanitizeToolSchema } from './schema-sanitizer.js'

describe('sanitizeToolSchema', () => {
  it('returns valid default schema for non-object inputs', () => {
    expect(sanitizeToolSchema(null)).toEqual({ type: 'object', properties: {} })
    expect(sanitizeToolSchema(undefined)).toEqual({ type: 'object', properties: {} })
    expect(sanitizeToolSchema('string')).toEqual({ type: 'object', properties: {} })
    expect(sanitizeToolSchema([])).toEqual({ type: 'object', properties: {} })
  })

  it('strips unsupported JSON schema keywords', () => {
    const input = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'http://example.com/schema.json',
      type: 'object',
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
