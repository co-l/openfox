/**
 * Schema Sanitizer
 *
 * Sanitizes JSON Schema tool parameters for broad LLM provider compatibility
 * (OpenAI, Gemini/Vertex AI/Antigravity, Anthropic, Ollama, etc.).
 *
 * Normalizes invalid or unsupported constructs:
 * - Strips `additionalProperties` (unsupported by Vertex AI / Antigravity protobuf Schema)
 * - Strips `null` values (e.g. `default: null`)
 * - Ensures `type: 'object'` always defines a valid `properties` map
 * - Empty or missing `items` in array schemas (`items: {}` -> `items: { type: 'string' }`)
 * - Strips meta keywords ($schema, $id, $vocabulary, etc.)
 * - Converts `const` values to `enum: [val]`
 * - Recursively processes properties, array items, and union branches (anyOf, oneOf, allOf)
 */

export function sanitizeToolSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {} }
  }

  return cleanSchemaNode(schema as Record<string, unknown>)
}

function cleanSchemaNode(node: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, val] of Object.entries(node)) {
    // Strip null / undefined values (e.g. default: null)
    if (val === null || val === undefined) {
      continue
    }

    // Strip meta keywords & additionalProperties unsupported across providers
    if (
      key === '$schema' ||
      key === '$id' ||
      key === '$vocabulary' ||
      key === '$anchor' ||
      key === 'dependentRequired' ||
      key === 'dependentSchemas' ||
      key === 'unevaluatedProperties' ||
      key === 'unevaluatedItems' ||
      key === 'patternProperties' ||
      key === 'additionalProperties'
    ) {
      continue
    }

    if (key === 'required' && Array.isArray(val)) {
      result['required'] = val.map((item) => (item === 'properties' ? 'props' : item))
      continue
    }

    if (key === 'const') {
      result['enum'] = [val]
      continue
    }

    if (key === 'properties' && val && typeof val === 'object' && !Array.isArray(val)) {
      const sanitizedProps: Record<string, unknown> = {}
      for (const [propKey, propVal] of Object.entries(val as Record<string, unknown>)) {
        // A property named 'properties' inside a properties map creates ambiguous/conflicting
        // Protobuf schemas for Gemini / Vertex AI (e.g. parameters.properties.properties).
        // Safely rename it to 'props'.
        const targetKey = propKey === 'properties' ? 'props' : propKey

        if (typeof propVal === 'string') {
          sanitizedProps[targetKey] = propVal === 'object' ? { type: 'object', properties: {} } : { type: propVal }
        } else if (propVal && typeof propVal === 'object' && !Array.isArray(propVal)) {
          sanitizedProps[targetKey] = cleanSchemaNode(propVal as Record<string, unknown>)
        } else {
          sanitizedProps[targetKey] = propVal
        }
      }
      result['properties'] = sanitizedProps
      continue
    }

    if (key === 'items') {
      if (!val || typeof val !== 'object' || Object.keys(val).length === 0) {
        result['items'] = { type: 'string' }
      } else if (Array.isArray(val)) {
        result['items'] = val.map((item) =>
          item && typeof item === 'object' ? cleanSchemaNode(item as Record<string, unknown>) : item,
        )
      } else {
        result['items'] = cleanSchemaNode(val as Record<string, unknown>)
      }
      continue
    }

    if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(val)) {
      result[key] = val.map((item) =>
        item && typeof item === 'object' ? cleanSchemaNode(item as Record<string, unknown>) : item,
      )
      continue
    }

    result[key] = val
  }

  // If type is object but properties is missing, provide empty properties map
  if (result['type'] === 'object' && !result['properties']) {
    result['properties'] = {}
  }

  // If type is array but items is missing or empty, supply a default string item schema
  if (
    result['type'] === 'array' &&
    (!result['items'] || (typeof result['items'] === 'object' && Object.keys(result['items'] as object).length === 0))
  ) {
    result['items'] = { type: 'string' }
  }

  return result
}
