/**
 * Shared JSON-settings parse helper.
 *
 * Settings are stored as a JSON string of an object keyed by id. Several
 * override/team maps share the same "parse + guard it's a plain object"
 * preamble; this centralizes it so jscpd stops flagging the boilerplate.
 */

export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}
