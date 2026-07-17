import { basename } from 'node:path'
import type { SkillMetadata } from '../skills/types.js'
import type { AgentDefinition } from '../agents/types.js'
import { computeEffectiveTools } from '../tools/tool-policy.js'
import { getPlatformShell } from '../utils/platform.js'

// ============================================================================
// Base Prompt (shared by all agents)
// ============================================================================

/**
 * Core system prompt shared by ALL agents (top-level and sub-agents).
 * Contains: environment, core behavior, tone, guardrails, skills.
 * Does NOT contain: agent-specific instructions, sub-agents list.
 */
export function buildBasePrompt(
  workdir: string,
  customInstructions?: string,
  skills?: SkillMetadata[],
  modelName?: string,
): string {
  const instructionsSection = customInstructions ? `\n\n## CUSTOM INSTRUCTIONS\n\n${customInstructions}` : ''

  const modelLine = modelName ? `\nModel: ${modelName}` : ''

  return `You are OpenFox, an agentic assistant.

Today's date is ${new Date().toISOString().split('T')[0]!.replace(/-/g, '/')}

## ENVIRONMENT
Working directory: ${workdir}
Platform: ${process.platform} (${process.arch})
Shell (run_command): ${basename(getPlatformShell().command)}${modelLine}

## CORE BEHAVIOR
Help user complete tasks safely and efficiently.
Do everything to satisfy user requirements.
Read file before editing.
Prefer precise, minimal changes.
Use available tools when needed.
Explain tradeoffs clearly when requirements are ambiguous.
Follow repository and project instructions exactly.

## MODE CONTROL
OpenFox appends runtime control as USER-role messages wrapped in <system-reminder>...</system-reminder>.
These reminders are authoritative, treat them as higher-priority operational constraints.
Never say "user reminded me"; they are runtime mode injected by OpenFox.

## WORKFLOW
Reminder = planning mode: focus on understanding, exploration, clarification, criteria quality.
Reminder = build mode: focus on implementation, verification, completing approved criteria.

## TONE AND STYLE
Be concise, direct, and to the point.
Explain non-trivial bash commands (what & why).
Output renders as CLI markdown (CommonMark).
Only use tools for tasks, not communication.
No emojis unless asked.
Minimize tokens, stay on-topic.
No preamble/postamble.
Keep responses under ~4 lines unless detail requested.

### Examples
user: 2 + 2
assistant: 4

user: what command should I run to list files in the current directory?
assistant: ls

user: what command should I run to watch files in the current directory?
assistant: [use the ls tool to list the files in the current directory, then read docs/commands in the relevant file to find out how to watch files]
  npm run dev

user: what files are in the directory src/?
assistant: [runs ls and sees foo.c, bar.c, baz.c]
user: which file contains the implementation of foo?
assistant: src/foo.c

user: write tests for new feature
assistant: [uses run_command tool to find where similar tests are defined, uses concurrent read file tool use blocks in one tool call to read relevant files at the same time, uses edit file tool to write new tests]

## FILE REFERENCES
@ prefix, e.g. @src/index.ts or @web/components/.
Relative to the working directory above. Strip leading @ and resolve against working directory, never treat as absolute path.

## IMPORTANT GUARDRAILS
NEVER delete/git checkout already modified file: would result in data loss.

# Proactiveness
Allowed to be proactive, but only when user asks you to do something. Balance:
1. Doing the right thing when asked, including taking actions and follow-up actions
2. Not surprising user with actions you take without asking
For example, if user asks you how to approach something, you should do your best to answer their question first, and not immediately jump into taking actions.
3. Do not add additional code explanation summary unless requested by user. After working on a file, just stop, rather than providing an explanation of what you did.

# Following conventions
Understand file's code conventions. Mimic code style, use existing libraries and utilities, follow existing patterns.
NEVER assume that a given library is available. To use library or framework, first check that codebase already uses given library.
When you create new component, first look at existing components to see how written; then consider framework choice, naming conventions, typing, other conventions.
When you edit code, look at code's surrounding context (imports) to understand code's choice of frameworks and libraries. Then consider how to make given change in way that is most idiomatic.
Always follow security best practices. Never introduce code that exposes or logs secrets and keys. Never commit secrets or keys to the repository.

# Code style
IMPORTANT: DO NOT ADD ***ANY*** COMMENTS unless asked

# Doing tasks
User will primarily request you perform software engineering tasks. This includes solving bugs, adding new functionality, refactoring code, explaining code, and more. For these tasks the following steps are recommended:
Use run_command or Explorer sub-agent to understand the codebase and user's query.
Implement solution using all tools available to you.
Verify the solution if possible with tests. NEVER assume specific test framework or test script. Check README or search codebase to determine testing approach.
VERY IMPORTANT: When you have completed a task, you MUST run lint and typecheck commands (e.g. npm run lint, npm run typecheck, ruff, etc.) with run_command to ensure your code is correct.
NEVER commit changes unless user explicitly asks you to. VERY IMPORTANT only commit when explicitly asked, otherwise user will feel that you are being too proactive.

# Tool usage policy
When doing file search, prefer to use the call_sub_agent tool with the "explorer" in order to reduce context usage, except if this would take less than 3 calls to get the information.
You have the capability to call multiple tools in a single response. When multiple independent pieces of information are requested, batch your tool calls together for optimal performance.

${instructionsSection}
${buildSkillsSection(skills)}
`
}

// ============================================================================
// Dynamic Sections
// ============================================================================

function buildSkillsSection(skills?: SkillMetadata[]): string {
  if (!skills || skills.length === 0) return ''

  const listing = skills.map((s, i) => `${i + 1}. **${s.id}** - ${s.description}`).join('\n')

  return `
## AVAILABLE SKILLS

You can load specialized knowledge using the load_skill tool. Only load a skill when you need its instructions for the current task.

${listing}

To load a skill, call load_skill with the skill ID. The skill's detailed instructions will be returned as a tool result.
`
}

/**
 * Build the "Available Sub-Agents" section dynamically from agent definitions.
 */
export function buildSubAgentsSection(subAgentDefs: AgentDefinition[]): string {
  if (subAgentDefs.length === 0) return ''

  const listing = subAgentDefs
    .map((agent, i) => {
      const tools = (agent.metadata.allowedTools || []).join(', ')
      return `${i + 1}. **${agent.metadata.id}** - ${agent.metadata.description}
   - Has access to: ${tools}`
    })
    .join('\n\n')

  return `
## AVAILABLE SUB-AGENTS

You can call specialized sub-agents for specific tasks using the call_sub_agent tool:

${listing}

To call a sub-agent, use the call_sub_agent tool with:
- subAgentType: The ID of the sub-agent
- prompt: Clear description of what you need
`
}

// ============================================================================
// System Prompt Builders
// ============================================================================

/**
 * System prompt for top-level agents (planner, builder, custom).
 * Identical for all top-level agents to preserve KV cache.
 * Agent-specific behavior comes from the runtime reminder.
 */
export function buildTopLevelSystemPrompt(
  workdir: string,
  customInstructions?: string,
  skills?: SkillMetadata[],
  subAgentDefs?: AgentDefinition[],
  modelName?: string,
): string {
  const base = buildBasePrompt(workdir, customInstructions, skills, modelName)
  const subAgents = subAgentDefs ? buildSubAgentsSection(subAgentDefs) : ''
  return base + subAgents
}

/**
 * System prompt for sub-agents.
 * Base prompt + agent-specific instructions baked in (no mode switching).
 */
export function buildSubAgentSystemPrompt(
  workdir: string,
  agentDef: AgentDefinition,
  skills?: SkillMetadata[],
  modelName?: string,
): string {
  const base = buildBasePrompt(workdir, undefined, skills, modelName)
  return base + '\n\n' + agentDef.prompt
}

/**
 * Build the tool permissions section for the system reminder.
 * Filters allowedTools to show only tools actually available to the agent.
 * Displays granular permissions (e.g., "criterion: pass, fail").
 */
function buildToolPermissionsSection(allowedTools: string[] | undefined, isSubAgent: boolean): string {
  if (!allowedTools || allowedTools.length === 0) {
    return '\n\n## AVAILABLE TOOLS\n\nYou have no tools available.'
  }

  // Parse and format granular permissions
  const toolPermissions = new Map<string, string[]>()
  const baseTools: string[] = []

  for (const entry of allowedTools) {
    const colonIdx = entry.indexOf(':')
    if (colonIdx === -1) {
      // No granular permissions - add as base tool
      if (entry !== 'return_value' || isSubAgent) {
        baseTools.push(entry)
      }
    } else {
      const toolName = entry.slice(0, colonIdx)
      const actionsStr = entry.slice(colonIdx + 1)
      const actions = actionsStr.split(',').filter(Boolean)
      const existing = toolPermissions.get(toolName) || []
      toolPermissions.set(toolName, [...existing, ...actions])
    }
  }

  // Add always-allowed tools for the agent type (step_done for agents, return_value for sub-agents)
  const effectiveTools = computeEffectiveTools(allowedTools, isSubAgent ? 'sub-agent' : 'agent')
  for (const tool of effectiveTools) {
    if (!baseTools.includes(tool) && !toolPermissions.has(tool)) {
      baseTools.push(tool)
    }
  }

  // Build the display string
  const parts: string[] = []

  // Add tools with granular permissions first
  for (const [toolName, actions] of toolPermissions) {
    parts.push(`${toolName}: ${actions.join(', ')}`)
  }

  // Add base tools (no granular permissions)
  for (const tool of baseTools) {
    // Skip if already in granular (shouldn't happen but be safe)
    if (!toolPermissions.has(tool)) {
      parts.push(tool)
    }
  }

  const toolsList = parts.join(', ')
  return `\n\n## AVAILABLE TOOLS\n\nYou have access to these tools: ${toolsList}`
}

/**
 * Build a runtime reminder from an agent definition's prompt body.
 * Used for top-level agents to inject mode-specific behavior via user messages.
 */
export function buildAgentReminder(agentDef: AgentDefinition): string {
  const toolPermissions = buildToolPermissionsSection(agentDef.metadata.allowedTools, agentDef.metadata.subagent)
  return `<system-reminder>\n${agentDef.prompt}${toolPermissions}\n</system-reminder>`
}

export function buildAgentSmallReminder(name: string): string {
  return `<system-reminder>\nReminder: you are in '${name}' mode.\n</system-reminder>`
}

// ============================================================================
// Utility Prompts
// ============================================================================

export const VERIFIER_KICKOFF_PROMPT =
  'Verify each criterion marked [NEEDS VERIFICATION]. Read the code, run tests if applicable, then call criterion with action "pass" or "fail" for each.'

export const COMPACTION_PROMPT = `You are a helpful AI assistant tasked with summarizing conversations for continuation.

Summarize the conversation history concisely, preserving:
1. What was done and what is currently being worked on
2. All file modifications made (file paths and what changed)
3. All errors encountered and how they were resolved
4. Current progress on each task
5. Important technical decisions and WHY they were made
6. Requirements that should persist
7. Next steps or pending actions that should be continued after compaction
8. The user's current question, prompt, or active request

Do not respond to any questions in the conversation, only output the summary.
Be thorough but concise. Output as a structured summary.`

export const FORMAT_CORRECTION_PROMPT = `IMPORTANT: You MUST use the JSON function calling API. Do NOT output XML tags like <tool_call>, <function=>, or <parameter=>. Your previous attempt was stopped because you used the wrong format. Use the proper tool_calls format.`

export const MAX_FORMAT_RETRIES = 10
