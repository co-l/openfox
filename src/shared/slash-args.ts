/**
 * Slash-command argument parsing.
 *
 * Shared by the chat composer (web) and the task board's server-side slash
 * resolution, so a command typed in chat and the same command seeded into a
 * task expand identically.
 *
 * Two argument forms:
 *   - positional — `{{name}}` placeholders filled by order of first appearance
 *   - whole-line — `{{ARGUMENTS}}` receives everything typed after the id,
 *     verbatim, and never consumes a positional slot
 */

/** Placeholder that captures the raw remainder of the line. */
export const ARGUMENTS_PARAM = 'ARGUMENTS'

export interface SlashInput {
  id: string
  /** Tokenized arguments, quotes honoured and stripped. */
  args: string[]
  /** Everything after the id, verbatim and trimmed. Feeds `{{ARGUMENTS}}`. */
  rest: string
}

/**
 * Split a command line into tokens, treating a `"…"` or `'…'` run as one
 * token so multi-word arguments survive. Inside double quotes a backslash
 * escapes the next character; single quotes are literal, as in POSIX shells.
 * An unterminated quote swallows the rest of the line rather than failing —
 * a half-typed argument should still do something sensible.
 */
export function tokenizeArgs(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let started = false
  let quote: '"' | "'" | null = null

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!

    if (quote === '"' && char === '\\' && i + 1 < line.length) {
      current += line[++i]!
      continue
    }

    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }

    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }

    current += char
    started = true
  }

  if (started) tokens.push(current)
  return tokens
}

/**
 * Split a prompt into a slash id, its tokenized args, and the raw remainder.
 * Returns null when the prompt is not a slash invocation (or is a bare "/").
 */
export function parseSlashInput(prompt: string): SlashInput | null {
  const trimmed = prompt.trim()
  if (!trimmed.startsWith('/')) return null

  const body = trimmed.slice(1)
  const separator = body.search(/\s/)
  const id = separator === -1 ? body : body.slice(0, separator)
  if (!id) return null

  const rest = separator === -1 ? '' : body.slice(separator).trim()
  return { id, args: tokenizeArgs(rest), rest }
}

/** Named template placeholders (`{{name}}`) in order of first occurrence, deduplicated. */
export function extractTemplateParams(template: string): string[] {
  const seen: string[] = []
  const regex = /\{\{(\w+)\}\}/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(template)) !== null) {
    const key = match[1]!
    if (!seen.includes(key)) seen.push(key)
  }
  return seen
}

/** Placeholders that take a positional argument — every one except `{{ARGUMENTS}}`. */
export function positionalTemplateParams(template: string): string[] {
  return extractTemplateParams(template).filter((name) => name !== ARGUMENTS_PARAM)
}

/**
 * Resolve a template's placeholders from a parsed invocation. Positional
 * placeholders take tokens in order; `{{ARGUMENTS}}` takes `rest` verbatim.
 * A placeholder with nothing to fill it is reported rather than substituted,
 * so callers can prompt for it instead of shipping `{{name}}` to the model.
 */
export function resolveTemplateParams(
  template: string,
  args: string[],
  rest = '',
): { params: Record<string, string>; unfilledParams: string[] } {
  const names = extractTemplateParams(template)
  const params: Record<string, string> = {}

  names
    .filter((name) => name !== ARGUMENTS_PARAM)
    .forEach((name, index) => {
      const value = args[index]
      if (value !== undefined) params[name] = value
    })

  if (names.includes(ARGUMENTS_PARAM) && rest) params[ARGUMENTS_PARAM] = rest

  return { params, unfilledParams: names.filter((name) => !(name in params)) }
}

/**
 * Placeholder names for inline composer hints: positional slots in the order
 * they must be typed, then `{{ARGUMENTS}}` last since it soaks up whatever
 * follows them.
 */
export function templateParamHints(template: string): string[] {
  const names = extractTemplateParams(template)
  const positional = names.filter((name) => name !== ARGUMENTS_PARAM)
  return names.includes(ARGUMENTS_PARAM) ? [...positional, ARGUMENTS_PARAM] : positional
}

/** Replace `{{name}}` placeholders with the supplied values. */
export function applyTemplateParams(template: string, params: Record<string, string>): string {
  let prompt = template
  for (const [key, value] of Object.entries(params)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value)
  }
  return prompt
}

/**
 * Expand a command template against an invocation's arguments, reporting any
 * placeholder left unfilled.
 */
export function expandCommandPrompt(
  template: string,
  args: string[],
  rest = '',
): { prompt: string; unfilledParams: string[] } {
  const { params, unfilledParams } = resolveTemplateParams(template, args, rest)
  return { prompt: applyTemplateParams(template, params), unfilledParams }
}
