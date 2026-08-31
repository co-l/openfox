import type { WorkflowParameter, WorkflowScope } from '@shared/types.js'
import { parseSlashInput } from '@shared/slash-args.js'

export { ARGUMENTS_PARAM, extractTemplateParams, tokenizeArgs } from '@shared/slash-args.js'

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
  /** Tokenized arguments, quoted runs kept whole. */
  args: string[]
  /** Everything typed after the id, verbatim — feeds `{{ARGUMENTS}}`. */
  rest: string
}

/**
 * Legacy alias — use extractTemplateParams instead.
 * @deprecated
 */
export { extractTemplateParams as extractPositionalParams } from '@shared/slash-args.js'

/**
 * Parse a slash command from chat input.
 * Returns null if the input is not a recognized slash command.
 */
export function parseSlashCommand(
  input: string,
  workflows: WorkflowInfo[],
  commands?: CommandInfo[],
): SlashCommandResult | null {
  const parsed = parseSlashInput(input)
  if (!parsed) return null

  const { id, args, rest } = parsed
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
    return { workflowId: id, params, args, rest }
  }

  // Then try command
  if (commands) {
    const cmd = commands.find((c) => c.id === id)
    if (cmd) {
      args.forEach((arg, i) => {
        params[String(i)] = arg
      })
      return { commandId: id, params, args, rest }
    }
  }

  return null
}
