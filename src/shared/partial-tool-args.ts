/**
 * Extract file-operation fields (path, content, old_string, new_string) from a
 * possibly-incomplete JSON arguments fragment, as streamed by tool.preparing
 * events. Falls back to scanning the raw fragment per key so the file content
 * shows up live while the LLM is still generating the JSON.
 */

export interface PartialFileArgs {
  path?: string
  content?: string
  old_string?: string
  new_string?: string
  replace_all?: boolean
}

const FILE_KEYS = ['path', 'content', 'old_string', 'new_string'] as const

export function parsePartialFileArgs(raw: string | undefined): PartialFileArgs {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Record<string, unknown>
      const out: PartialFileArgs = {}
      for (const key of FILE_KEYS) {
        if (typeof p[key] === 'string') out[key] = p[key]
      }
      if (typeof p['replace_all'] === 'boolean') out.replace_all = p['replace_all']
      return out
    }
  } catch {
    // Incomplete fragment — fall through to the per-key scan below.
  }
  const out: PartialFileArgs = {}
  for (const key of FILE_KEYS) {
    const value = extractJsonStringField(raw, key)
    if (value !== undefined) out[key] = value
  }
  const replaceAll = raw.match(/"replace_all"\s*:\s*(true|false)/)?.[1]
  if (replaceAll) out.replace_all = replaceAll === 'true'
  return out
}

// Read the raw (still escaped) string value of `"key"` from a JSON fragment,
// stopping at the closing quote or the end of the fragment.
function extractJsonStringField(raw: string, key: string): string | undefined {
  const keyIdx = raw.indexOf(`"${key}"`)
  if (keyIdx < 0) return undefined
  const colonIdx = raw.indexOf(':', keyIdx + key.length + 2)
  if (colonIdx < 0) return undefined
  const quoteIdx = raw.indexOf('"', colonIdx + 1)
  if (quoteIdx < 0) return undefined
  let i = quoteIdx + 1
  let value = ''
  while (i < raw.length) {
    const ch = raw[i]!
    if (ch === '\\') {
      const next = raw[i + 1]
      if (next === undefined) break
      value += ch + next
      i += 2
      continue
    }
    if (ch === '"') break
    value += ch
    i++
  }
  return unescapeJsonStringPartial(value)
}

// Unescape a JSON string body, tolerating a trailing incomplete escape
// sequence (the fragment may end mid-stream, e.g. a lone backslash).
function unescapeJsonStringPartial(value: string): string {
  let out = ''
  let i = 0
  while (i < value.length) {
    const ch = value[i]!
    if (ch !== '\\') {
      out += ch
      i++
      continue
    }
    const next = value[i + 1]
    if (next === undefined) return out
    switch (next) {
      case 'n':
        out += '\n'
        i += 2
        break
      case 't':
        out += '\t'
        i += 2
        break
      case 'r':
        out += '\r'
        i += 2
        break
      case 'b':
        out += '\b'
        i += 2
        break
      case 'f':
        out += '\f'
        i += 2
        break
      case '"':
        out += '"'
        i += 2
        break
      case '\\':
        out += '\\'
        i += 2
        break
      case '/':
        out += '/'
        i += 2
        break
      case 'u': {
        const hex = value.slice(i + 2, i + 6)
        if (hex.length < 4) return out
        const code = parseInt(hex, 16)
        if (Number.isNaN(code)) return out
        out += String.fromCharCode(code)
        i += 6
        break
      }
      default:
        out += next
        i += 2
    }
  }
  return out
}
