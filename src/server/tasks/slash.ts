/**
 * Slash-command resolution for the project task board.
 *
 * Tasks may begin with a slash command or workflow reference (identical to
 * typing it in the chat composer). Seeding a task's session resolves that
 * invocation here — server-side, so auto-launched tasks behave exactly like
 * tasks the human typed. Resolution order matches chat: workflow first, then
 * command, otherwise no slash launch (the raw prompt is used).
 *
 * The parsing/expansion helpers are pure and unit-tested; the filesystem
 * lookup is async (commands/workflows are loaded from disk).
 */

import { loadAllCommands, findCommandById } from '../commands/registry.js'
import { loadAllWorkflows, findWorkflowById } from '../workflows/registry.js'

export interface SlashInvocation {
  id: string
  args: string[]
}

export interface WorkflowSlashLaunch {
  kind: 'workflow'
  workflowId: string
  params: Record<string, string>
}

export interface CommandSlashLaunch {
  kind: 'command'
  /** Fully expanded prompt template (placeholders substituted). */
  prompt: string
  agentMode?: string
}

export type SlashLaunch = WorkflowSlashLaunch | CommandSlashLaunch | null

/**
 * Split a prompt into a slash id + positional args. Returns null when the
 * prompt is not a slash invocation (or is just a bare "/").
 */
export function parseSlashInvocation(prompt: string): SlashInvocation | null {
  const trimmed = prompt.trim()
  if (!trimmed.startsWith('/')) return null
  const parts = trimmed.slice(1).split(/\s+/)
  const id = parts[0]
  if (!id) return null
  return { id, args: parts.slice(1) }
}

/**
 * Map positional args onto a workflow's declared parameters (by position,
 * mirroring the chat composer). With no declared parameters the args keep
 * their positional keys so the workflow can consume them positionally.
 */
export function workflowParamsFromArgs(
  parameters: { id: string; position?: number }[] | undefined,
  args: string[],
): Record<string, string> {
  const params: Record<string, string> = {}
  if (!parameters || parameters.length === 0) {
    args.forEach((value, index) => {
      params[String(index)] = value
    })
    return params
  }
  const sorted = [...parameters].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  sorted.forEach((param, index) => {
    const value = args[index]
    if (value !== undefined) params[param.id] = value
  })
  return params
}

/** Named template placeholders ({{name}}) in order of first occurrence, deduplicated. */
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

/**
 * Substitute positional args into a command's prompt template. Args map to
 * placeholders by order of appearance. Returns the expanded prompt plus the
 * placeholders that remain unfilled (so callers can degrade gracefully).
 */
export function expandCommandPrompt(template: string, args: string[]): { prompt: string; unfilledParams: string[] } {
  const paramNames = extractTemplateParams(template)
  const named: Record<string, string> = {}
  paramNames.forEach((name, index) => {
    const value = args[index]
    if (value !== undefined) named[name] = value
  })
  let prompt = template
  for (const [key, value] of Object.entries(named)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value)
  }
  const unfilledParams = paramNames.filter((name) => !(name in named))
  return { prompt, unfilledParams }
}

/**
 * Resolve a prompt against the available workflows and commands. Returns null
 * when the prompt is not a slash invocation, the id is unknown, or a matched
 * command can't be fully expanded (caller then uses the raw prompt).
 */
export async function resolveSlashLaunch(
  configDir: string,
  projectDir: string | undefined,
  prompt: string,
): Promise<SlashLaunch> {
  const invocation = parseSlashInvocation(prompt)
  if (!invocation) return null

  const workflows = await loadAllWorkflows(configDir, projectDir)
  const workflow = findWorkflowById(invocation.id, workflows)
  if (workflow) {
    const params = workflowParamsFromArgs(workflow.metadata.parameters, invocation.args)
    const required = (workflow.metadata.parameters ?? []).filter((p) => p.required).map((p) => p.id)
    const missingRequired = required.filter((id) => !(id in params))
    if (missingRequired.length > 0) {
      // The workflow can't start without them — degrade to the raw prompt so a
      // seeded session never wedges on a workflow that won't boot.
      return null
    }
    return {
      kind: 'workflow',
      workflowId: workflow.metadata.id,
      params,
    }
  }

  const commands = await loadAllCommands(configDir, projectDir)
  const command = findCommandById(invocation.id, commands)
  if (!command) return null

  const expanded = expandCommandPrompt(command.prompt, invocation.args)
  if (expanded.unfilledParams.length > 0) return null

  return {
    kind: 'command',
    prompt: expanded.prompt,
    ...(command.metadata.agentMode ? { agentMode: command.metadata.agentMode } : {}),
  }
}
