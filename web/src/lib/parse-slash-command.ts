import type { WorkflowParameter, WorkflowScope } from '@shared/types.js'

export interface WorkflowInfo {
  id: string
  name: string
  parameters?: WorkflowParameter[]
  /** Which scope this definition lives in (server-annotated). */
  scope: WorkflowScope
}

export interface CommandInfo {
  id: string
  name: string
  paramNames?: string[]
}

export interface SlashCommandResult {
  workflowId?: string
  commandId?: string
  params: Record<string, string>
}

/**
 * Extract template parameter placeholders ({{name}}) from a template string.
 * Returns them in order of first occurrence, deduplicated.
 */
export function extractTemplateParams(template: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  const regex = /\{\{(\w+)\}\}/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(template)) !== null) {
    const key = match[1]!
    if (!seen.has(key)) {
      seen.add(key)
      result.push(key)
    }
  }
  return result
}

/**
 * Legacy alias — use extractTemplateParams instead.
 * @deprecated
 */
export const extractPositionalParams = extractTemplateParams

export const BUILTIN_RENAME_ID = 'rename'

export interface BuiltinRenameResult {
  builtin: typeof BUILTIN_RENAME_ID
  title: string
}

export type BuiltinSlashResult = BuiltinRenameResult

/**
 * Parse a client-side built-in slash command (currently only `/rename <title>`).
 * The whole remainder of the input is the argument, spaces included. A user
 * workflow or command with the same id keeps precedence, so this returns null.
 */
export function parseBuiltinSlashCommand(
  input: string,
  workflows: WorkflowInfo[],
  commands?: CommandInfo[],
): BuiltinSlashResult | null {
  const match = input.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
  if (!match || match[1] !== BUILTIN_RENAME_ID) return null
  if (workflows.some((w) => w.id === BUILTIN_RENAME_ID)) return null
  if (commands?.some((c) => c.id === BUILTIN_RENAME_ID)) return null
  return { builtin: BUILTIN_RENAME_ID, title: (match[2] ?? '').trim() }
}

/**
 * Parse a slash command from chat input.
 * Returns null if the input is not a recognized slash command.
 */
export function parseSlashCommand(
  input: string,
  workflows: WorkflowInfo[],
  commands?: CommandInfo[],
): SlashCommandResult | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  const parts = trimmed.slice(1).split(/\s+/)
  const id = parts[0]
  if (!id) return null

  const args = parts.slice(1)
  const params: Record<string, string> = {}

  // Try workflow first
  const wf = workflows.find((w) => w.id === id)
  if (wf) {
    if (wf.parameters && wf.parameters.length > 0) {
      const sorted = [...wf.parameters].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      sorted.forEach((p, i) => {
        if (args[i] !== undefined) {
          params[p.id] = args[i]!
        }
      })
    } else {
      args.forEach((arg, i) => {
        params[String(i)] = arg
      })
    }
    return { workflowId: id, params }
  }

  // Then try command
  if (commands) {
    const cmd = commands.find((c) => c.id === id)
    if (cmd) {
      args.forEach((arg, i) => {
        params[String(i)] = arg
      })
      return { commandId: id, params }
    }
  }

  return null
}
