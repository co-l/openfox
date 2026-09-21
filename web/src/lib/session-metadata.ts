import type { PreparingToolCall } from '@shared/types.js'

export interface ParsedMetadataArgs {
  action?: string
  key?: string
  id?: string
  description?: string
}

// Parse session_metadata arguments (action/key/id/description). Handles both
// complete JSON and partial streaming fragments (regex fallback).
export function parseSessionMetadataArgs(args?: string): ParsedMetadataArgs | null {
  if (!args) return null
  try {
    const parsed: unknown = JSON.parse(args)
    if (typeof parsed !== 'object' || parsed === null) return null
    const p = parsed as Record<string, unknown>
    return {
      ...(typeof p.action === 'string' ? { action: p.action } : {}),
      ...(typeof p.key === 'string' ? { key: p.key } : {}),
      ...(typeof p.id === 'string' ? { id: p.id } : {}),
      ...(typeof p.description === 'string' ? { description: p.description } : {}),
    }
  } catch {
    const action = args.match(/"action"\s*:\s*"([^"]*)"/)?.[1]
    const key = args.match(/"key"\s*:\s*"([^"]*)/)?.[1]
    const id = args.match(/"id"\s*:\s*"([^"]*)"/)?.[1]
    const description = args.match(/"description"\s*:\s*"([^"]*)/)?.[1]
    if (!action && !key && !id && !description) return null
    return {
      ...(action ? { action } : {}),
      ...(key ? { key } : {}),
      ...(id ? { id } : {}),
      ...(description ? { description } : {}),
    }
  }
}

// True when a preparing call is adding an item to a metadata key. Such calls
// render inside the criteria group (live rows) instead of a generic preparing
// card.
export function isMetadataAddPreparing(ptc: PreparingToolCall): boolean {
  if (ptc.name !== 'session_metadata') return false
  const parsed = parseSessionMetadataArgs(ptc.arguments)
  return parsed?.action === 'add' && Boolean(parsed.key)
}
