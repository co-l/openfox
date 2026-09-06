import { authFetch } from './api'
import { resource, snapshot } from './resourceCache'
import type { AgentInfo } from './agents-actions'
import type { AgentFull } from './agents-actions'
import type { CommandInfo, CommandFull } from './commands-actions'
import type { WorkflowInfo, WorkflowFull, TemplateVariable } from './workflows-actions'
import type { SkillInfo, SkillFull, SelectedSkillDirectory } from './skills-actions'
import type { Provider, PlatformInfo, LlmStatus, Backend } from '../stores/config'
import type {
  WorkflowScope,
  Project,
  ModelConfig,
  ProjectTask,
  ProjectTaskCounts,
  ProjectTaskSettings,
  TaskGateConfig,
} from '@shared/types.js'
import type { WorkspaceConfig as SharedWorkspaceConfig } from '@shared/workspace.js'
import type { DevServerConfig, DevServerStatus } from '@shared/dev-server.js'

export interface AgentsData {
  defaults: AgentInfo[]
  userItems: AgentInfo[]
  projectItems: AgentInfo[]
  modelOverrides: Record<string, string>
}

export const agentsUrl = (path: string, workdir?: string): string =>
  workdir ? `${path}?workdir=${encodeURIComponent(workdir)}` : path

export async function fetchAgents(workdir?: string): Promise<AgentsData> {
  const res = await authFetch(agentsUrl('/api/agents', workdir))
  if (!res.ok) throw new Error(`Failed to load agents (${res.status})`)
  const data = (await res.json()) as Partial<AgentsData>
  return {
    defaults: data.defaults ?? [],
    userItems: data.userItems ?? [],
    projectItems: data.projectItems ?? [],
    modelOverrides: data.modelOverrides ?? {},
  }
}

export const agentsResource = resource<AgentsData, [string?]>({
  key: (workdir) => `agents:${workdir ?? ''}`,
  fetch: fetchAgents,
  maxAgeMs: 60_000,
})

/** Synchronous cache read for non-hook call sites (event handlers, getState-style reads). */
export function readAgents(workdir?: string): AgentsData | undefined {
  return snapshot<AgentsData>(agentsResource.keyOf(workdir)).data
}

/** Append a workdir scope query when present (shared by scoped entity resources). */
export const scopedUrl = (path: string, workdir?: string): string =>
  workdir ? `${path}?workdir=${encodeURIComponent(workdir)}` : path

export interface CommandsData {
  defaults: CommandInfo[]
  userItems: CommandInfo[]
  projectItems: CommandInfo[]
}

export async function fetchCommands(workdir?: string): Promise<CommandsData> {
  const res = await authFetch(scopedUrl('/api/commands', workdir))
  if (!res.ok) throw new Error(`Failed to load commands (${res.status})`)
  const data = (await res.json()) as Partial<CommandsData>
  return {
    defaults: data.defaults ?? [],
    userItems: data.userItems ?? [],
    projectItems: data.projectItems ?? [],
  }
}

export const commandsResource = resource<CommandsData, [string?]>({
  key: (workdir) => `commands:${workdir ?? ''}`,
  fetch: fetchCommands,
  maxAgeMs: 60_000,
})

/** Synchronous cache read for non-hook call sites (event handlers, getState-style reads). */
export function readCommands(workdir?: string): CommandsData | undefined {
  return snapshot<CommandsData>(commandsResource.keyOf(workdir)).data
}

export async function fetchCommand(commandId: string, workdir?: string): Promise<CommandFull | null> {
  const res = await authFetch(scopedUrl(`/api/commands/${commandId}`, workdir))
  if (!res.ok) return null
  return (await res.json()) as CommandFull
}

/** Single-entity command detail, keyed by id + workdir; invalidated on edit. */
export const commandResource = resource<CommandFull | null, [string, string?]>({
  key: (commandId, workdir) => `command:${commandId}:${workdir ?? ''}`,
  fetch: fetchCommand,
})

export async function fetchCommandDefault(commandId: string): Promise<CommandFull | null> {
  const res = await authFetch(`/api/commands/defaults/${commandId}`)
  if (!res.ok) return null
  return (await res.json()) as CommandFull
}

/** Built-in command content, keyed by id (defaults are never workdir-scoped). */
export const commandDefaultResource = resource<CommandFull | null, [string]>({
  key: (commandId) => `command-default:${commandId}`,
  fetch: fetchCommandDefault,
})

export interface WorkflowsData {
  defaults: WorkflowInfo[]
  userItems: WorkflowInfo[]
  projectItems: WorkflowInfo[]
  activeWorkflowId: string
}

export async function fetchWorkflows(workdir?: string): Promise<WorkflowsData> {
  const res = await authFetch(scopedUrl('/api/workflows', workdir))
  if (!res.ok) throw new Error(`Failed to load workflows (${res.status})`)
  const data = (await res.json()) as Partial<WorkflowsData>
  return {
    defaults: data.defaults ?? [],
    userItems: data.userItems ?? [],
    projectItems: data.projectItems ?? [],
    activeWorkflowId: data.activeWorkflowId ?? 'default',
  }
}

export const workflowsResource = resource<WorkflowsData, [string?]>({
  key: (workdir) => `workflows:${workdir ?? ''}`,
  fetch: fetchWorkflows,
  maxAgeMs: 60_000,
})

/** Flat list of every workflow across scopes, preserving all scope variants. */
export function selectAllWorkflows(data: {
  defaults: WorkflowInfo[]
  userItems: WorkflowInfo[]
  projectItems: WorkflowInfo[]
}): WorkflowInfo[] {
  return [...data.defaults, ...data.userItems, ...data.projectItems]
}

/** Synchronous merged read for non-hook call sites; empty when the scope was never loaded. */
export function readAllWorkflows(workdir?: string): WorkflowInfo[] {
  const data = readWorkflows(workdir)
  return data ? selectAllWorkflows(data) : []
}

/** Synchronous cache read for non-hook call sites (event handlers, getState-style reads). */
export function readWorkflows(workdir?: string): WorkflowsData | undefined {
  return snapshot<WorkflowsData>(workflowsResource.keyOf(workdir)).data
}

function scopeQuery(base: string, scope: WorkflowScope | undefined): string {
  if (!scope) return base
  return `${base}${base.includes('?') ? '&' : '?'}scope=${scope}`
}

export async function fetchWorkflow(id: string, workdir?: string, scope?: WorkflowScope): Promise<WorkflowFull | null> {
  const res = await authFetch(scopeQuery(scopedUrl(`/api/workflows/${id}`, workdir), scope))
  if (!res.ok) return null
  return (await res.json()) as WorkflowFull
}

/** Single-entity workflow detail, keyed by id + workdir + scope; invalidated on edit. */
export const workflowResource = resource<WorkflowFull | null, [string, string?, WorkflowScope?]>({
  key: (id, workdir, scope) => `workflow:${id}:${workdir ?? ''}:${scope ?? ''}`,
  fetch: fetchWorkflow,
})

export async function fetchWorkflowDefault(id: string, workdir?: string): Promise<WorkflowFull | null> {
  const res = await authFetch(scopedUrl(`/api/workflows/defaults/${id}`, workdir))
  if (!res.ok) return null
  return (await res.json()) as WorkflowFull
}

/** Built-in workflow content, keyed by id + workdir (defaults carry workdir scope). */
export const workflowDefaultResource = resource<WorkflowFull | null, [string, string?]>({
  key: (id, workdir) => `workflow-default:${id}:${workdir ?? ''}`,
  fetch: fetchWorkflowDefault,
})

export interface TemplateVariablesData {
  variables: TemplateVariable[]
}

export async function fetchTemplateVariables(): Promise<TemplateVariablesData> {
  const res = await authFetch('/api/workflows/template-variables')
  if (!res.ok) throw new Error(`Failed to load template variables (${res.status})`)
  const data = (await res.json()) as Partial<TemplateVariablesData>
  return { variables: data.variables ?? [] }
}

export const templateVariablesResource = resource<TemplateVariablesData, []>({
  key: () => 'workflow-template-variables',
  fetch: fetchTemplateVariables,
})

export interface SkillsData {
  defaults: SkillInfo[]
  userItems: SkillInfo[]
  projectItems: SkillInfo[]
  items: SkillInfo[]
  selectedDirectory: SelectedSkillDirectory | null
  diagnostics: string[]
}

export async function fetchSkills(workdir?: string): Promise<SkillsData> {
  const res = await authFetch(scopedUrl('/api/skills', workdir))
  if (!res.ok) throw new Error(`Failed to load skills (${res.status})`)
  const data = (await res.json()) as Partial<SkillsData>
  return {
    defaults: data.defaults ?? [],
    userItems: data.userItems ?? [],
    projectItems: data.projectItems ?? [],
    items: data.items ?? [],
    selectedDirectory: data.selectedDirectory ?? null,
    diagnostics: data.diagnostics ?? [],
  }
}

export const skillsResource = resource<SkillsData, [string?]>({
  key: (workdir) => `skills:${workdir ?? ''}`,
  fetch: fetchSkills,
  maxAgeMs: 60_000,
})

/** Synchronous cache read for non-hook call sites (event handlers, getState-style reads). */
export function readSkills(workdir?: string): SkillsData | undefined {
  return snapshot<SkillsData>(skillsResource.keyOf(workdir)).data
}

export async function fetchSkill(skillId: string, workdir?: string): Promise<SkillFull | null> {
  const res = await authFetch(scopedUrl(`/api/skills/${skillId}`, workdir))
  if (!res.ok) return null
  return (await res.json()) as SkillFull
}

/** Single-entity skill detail, keyed by id + workdir; invalidated on edit. */
export const skillResource = resource<SkillFull | null, [string, string?]>({
  key: (skillId, workdir) => `skill:${skillId}:${workdir ?? ''}`,
  fetch: fetchSkill,
})

export async function fetchSkillDefault(skillId: string): Promise<SkillFull | null> {
  const res = await authFetch(`/api/skills/defaults/${skillId}`)
  if (!res.ok) return null
  return (await res.json()) as SkillFull
}

/** Built-in skill content, keyed by id (defaults are never workdir-scoped). */
export const skillDefaultResource = resource<SkillFull | null, [string]>({
  key: (skillId) => `skill-default:${skillId}`,
  fetch: fetchSkillDefault,
})

export async function fetchMcpServers(): Promise<McpServerInfo[]> {
  const res = await authFetch('/api/mcp/servers')
  if (!res.ok) throw new Error(`Failed to load MCP servers (${res.status})`)
  const data = (await res.json()) as { servers?: McpServerInfo[] }
  return [...(data.servers ?? [])].sort((a, b) => a.name.localeCompare(b.name))
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  enabled: boolean
  estimatedTokens: number
}

export interface McpServerInfo {
  name: string
  status: string
  tools: McpToolInfo[]
  estimatedTokens: number
  config: {
    transport?: string
    command?: string
    args?: string[]
    url?: string
    disabled?: boolean
  }
}

export interface ProjectsData {
  projects: Project[]
}

export async function fetchProjects(): Promise<ProjectsData> {
  const res = await authFetch('/api/projects')
  if (!res.ok) throw new Error(`Failed to load projects (${res.status})`)
  const data = (await res.json()) as Partial<ProjectsData>
  return { projects: data.projects ?? [] }
}

/** Global project list (no scope — all projects). */
export const projectsResource = resource<ProjectsData, []>({
  key: () => 'projects:list',
  fetch: fetchProjects,
  maxAgeMs: 60_000,
})

/** Synchronous cache read for non-hook call sites (event handlers, getState-style reads). */
export function readProjects(): ProjectsData | undefined {
  return snapshot<ProjectsData>(projectsResource.keyOf()).data
}

export async function fetchProject(projectId: string): Promise<Project | null> {
  if (!projectId) return null
  const res = await authFetch(`/api/projects/${projectId}`)
  if (!res.ok) return null
  const data = (await res.json()) as { project?: Project }
  return data.project ?? null
}

/** Single-entity project detail, keyed by projectId; invalidated/refreshed on edit. */
export const projectResource = resource<Project | null, [string]>({
  key: (projectId) => `project:${projectId}`,
  fetch: fetchProject,
})

/** Synchronous cache read for non-hook call sites (event handlers, getState-style reads). */
export function readProject(projectId: string): Project | null | undefined {
  return snapshot<Project | null>(projectResource.keyOf(projectId)).data
}

export interface ProvidersData {
  providers: Provider[]
  activeProviderId: string | null
}

export async function fetchProviders(): Promise<ProvidersData> {
  const res = await authFetch('/api/providers')
  if (!res.ok) throw new Error(`Failed to load providers (${res.status})`)
  const data = (await res.json()) as Partial<ProvidersData>
  return { providers: data.providers ?? [], activeProviderId: data.activeProviderId ?? null }
}

/** Global providers list + active provider id (providers carry their inline models). */
export const providersResource = resource<ProvidersData, []>({
  key: () => 'providers:list',
  fetch: fetchProviders,
  maxAgeMs: 60_000,
})

/** Synchronous cache read for non-hook call sites (event handlers, getState-style reads). */
export function readProviders(): ProvidersData | undefined {
  return snapshot<ProvidersData>(providersResource.keyOf()).data
}

export interface ProviderModelsData {
  models: ModelConfig[]
}

export async function fetchProviderModels(providerId: string): Promise<ProviderModelsData> {
  const res = await authFetch(`/api/providers/${providerId}/models`)
  if (!res.ok) throw new Error(`Failed to load models for provider ${providerId} (${res.status})`)
  const data = (await res.json()) as Partial<ProviderModelsData>
  return { models: data.models ?? [] }
}

/** Per-provider model list — refreshing one provider never invalidates the others. */
export const providerModelsResource = resource<ProviderModelsData, [string]>({
  key: (providerId) => `provider-models:${providerId}`,
  fetch: fetchProviderModels,
})

export interface VisionFallbackConfig {
  enabled: boolean
  url: string
  model: string
  timeout: number
  backend: 'ollama' | 'openai'
  providerModelRef?: string
}

export interface ConfigData {
  version: string | null
  model: string | null
  maxContext: number
  llmUrl: string | null
  llmStatus: LlmStatus
  backend: Backend
  defaultModelSelection: string | null
  platform: PlatformInfo | null
  workdir: string | null
  visionFallback: VisionFallbackConfig | null
  /** UI locale setting: 'automatic' | 'en' | 'fr' (resolved client-side). */
  locale: string
}

function normalizePlatform(platform: unknown): PlatformInfo | null {
  if (!platform || typeof platform !== 'object') return null
  const p = platform as Record<string, unknown>
  return {
    isWSL: !!(p.isWSL as boolean | undefined),
    wslDistro: String(p.wslDistro ?? ''),
  }
}

export async function fetchConfig(): Promise<ConfigData> {
  const res = await authFetch('/api/config')
  if (!res.ok) throw new Error(`Failed to load config (${res.status})`)
  const data = (await res.json()) as Record<string, unknown>
  return {
    version: (data.version as string | undefined) ?? null,
    model: (data.model as string | undefined) ?? null,
    maxContext: (data.maxContext as number | undefined) ?? 200000,
    llmUrl: (data.llmUrl as string | undefined) ?? null,
    llmStatus: (data.llmStatus as LlmStatus | undefined) ?? 'unknown',
    backend: (data.backend as Backend | undefined) ?? 'unknown',
    defaultModelSelection: (data.defaultModelSelection as string | undefined) ?? null,
    platform: normalizePlatform(data.platform),
    workdir: (data.workdir as string | undefined) ?? null,
    visionFallback: (data.visionFallback as VisionFallbackConfig | undefined) ?? null,
    locale: (data.locale as string | undefined) ?? 'automatic',
  }
}

/** Runtime selection + app-level config (excludes the providers list). */
export const configResource = resource<ConfigData, []>({
  key: () => 'config:runtime',
  fetch: fetchConfig,
})

/** Synchronous cache read for non-hook call sites (event handlers, getState-style reads). */
export function readConfig(): ConfigData | undefined {
  return snapshot<ConfigData>(configResource.keyOf()).data
}

export const EMPTY_TASK_COUNTS: ProjectTaskCounts = {
  open: 0,
  backlog: 0,
  todo: 0,
  inProgress: 0,
  running: 0,
  queued: 0,
  review: 0,
  done: 0,
}

export interface BoardData {
  tasks: ProjectTask[]
  settings: ProjectTaskSettings
  counts: ProjectTaskCounts
  gates: TaskGateConfig[]
}

export async function fetchBoard(projectId: string): Promise<BoardData> {
  if (!projectId) {
    return { tasks: [], settings: { slotLimit: 1, queuePaused: false }, counts: EMPTY_TASK_COUNTS, gates: [] }
  }
  const res = await authFetch(`/api/projects/${projectId}/tasks`)
  if (!res.ok) throw new Error(`Failed to load task board (${res.status})`)
  const data = (await res.json()) as Partial<BoardData>
  return {
    tasks: data.tasks ?? [],
    settings: data.settings ?? { slotLimit: 1, queuePaused: false },
    counts: data.counts ?? EMPTY_TASK_COUNTS,
    gates: data.gates ?? [],
  }
}

/**
 * Per-project task board. Both pipelines converge here: fetch fills the cache,
 * WS pushes write-through via `write` (no refetch storm).
 */
export const boardResource = resource<BoardData, [string]>({
  key: (projectId) => `tasks:board:${projectId}`,
  fetch: fetchBoard,
  maxAgeMs: 60_000,
})

/** Synchronous cache read for non-hook call sites (event handlers, getState-style reads). */
export function readBoard(projectId: string): BoardData | undefined {
  return snapshot<BoardData>(boardResource.keyOf(projectId)).data
}

export async function fetchTaskFromSession(projectId: string, sessionId: string): Promise<ProjectTask | null> {
  if (!projectId || !sessionId) return null
  const res = await authFetch(`/api/projects/${projectId}/tasks/from-session/${sessionId}`)
  if (!res.ok) return null
  const data = (await res.json()) as { task?: ProjectTask | null }
  return data.task ?? null
}

/** Board task linked to a session (post-plan decision bar). Fresh on mount. */
export const taskFromSessionResource = resource<ProjectTask | null, [string, string]>({
  key: (projectId, sessionId) => `tasks:from-session:${projectId}:${sessionId}`,
  fetch: fetchTaskFromSession,
  maxAgeMs: 0,
})

export interface TaskCountsData {
  counts: ProjectTaskCounts
}

export async function fetchTaskCounts(projectId: string): Promise<TaskCountsData> {
  if (!projectId) return { counts: EMPTY_TASK_COUNTS }
  const res = await authFetch(`/api/projects/${projectId}/tasks/count`)
  if (!res.ok) throw new Error(`Failed to load task counts (${res.status})`)
  const data = (await res.json()) as Partial<TaskCountsData>
  return { counts: data.counts ?? EMPTY_TASK_COUNTS }
}

/** Per-project task counts (homepage chips, header running badge). */
export const summariesResource = resource<TaskCountsData, [string]>({
  key: (projectId) => `tasks:counts:${projectId}`,
  fetch: fetchTaskCounts,
  maxAgeMs: 60_000,
})

/**
 * Global MCP server list (single endpoint, no scope). Receives WS write-through
 * pushes via `write` so live server changes converge without a refetch.
 */
export const mcpServersResource = resource<McpServerInfo[], []>({
  key: () => 'mcp:servers',
  fetch: fetchMcpServers,
})

/** Per-key server-persisted setting. The server applies its defaults, so a null
 * value is normalized to '' exactly like the retired settings store did. */
export async function fetchSetting(key: string): Promise<string> {
  const res = await authFetch(`/api/settings/${key}`)
  if (!res.ok) throw new Error(`Failed to load setting (${res.status})`)
  const data = (await res.json()) as { value?: string | null }
  return data.value ?? ''
}

/** Single setting value, keyed by its setting key. Consumers converge on the
 * same entry; saving writes through so every subscriber updates at once. */
export const settingResource = resource<string, [string]>({
  key: (key) => `settings:${key}`,
  fetch: fetchSetting,
  maxAgeMs: 60_000,
})

/** Persist a setting: PUT, then write the server-confirmed value through so
 * all subscribers on the key converge immediately (no follow-up GET). */
export async function setSetting(key: string, value: string): Promise<void> {
  const res = await authFetch(`/api/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) return
  const data = (await res.json()) as { value?: string | null }
  settingResource.write(data.value ?? value, key)
}

/** In-flight batched settings request, keyed by the joined key list so two
 * concurrent warm-ups with identical keys share one request. */
let bulkInFlight: { keys: string; promise: Promise<void> } | null = null

/**
 * Eager batch warm-up: fetch many setting keys in one request and write each
 * value through into its per-key entry so per-key consumers converge without
 * N individual fetches or a flash of defaults. Single-flight for the same key
 * set (concurrent duplicate warm-ups collapse into one request).
 */
export async function fetchSettingsBulk(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  const keyList = keys.join(',')
  if (bulkInFlight && bulkInFlight.keys === keyList) {
    return bulkInFlight.promise
  }
  const promise = (async () => {
    try {
      const res = await authFetch(`/api/settings?keys=${encodeURIComponent(keyList)}`)
      if (!res.ok) return
      const data = (await res.json()) as Record<string, string | undefined>
      for (const key of keys) {
        const value = data[key]
        if (value !== undefined) settingResource.write(value, key)
      }
    } finally {
      if (bulkInFlight && bulkInFlight.keys === keyList) bulkInFlight = null
    }
  })()
  bulkInFlight = { keys: keyList, promise }
  return promise
}

// Well-known settings keys (should match server's SETTINGS_KEYS)
export const SETTINGS_KEYS = {
  GLOBAL_INSTRUCTIONS: 'global_instructions',
  LANGUAGE: 'agent.language',
  NOTIFICATION_SETTINGS: 'notification_settings',
  DISPLAY_SHOW_THINKING: 'display.showThinking',
  DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT: 'display.showVerboseToolOutput',
  DISPLAY_LOCALE: 'display.locale',
  DISPLAY_SHOW_STATS: 'display.showStats',
  DISPLAY_SHOW_AGENT_DEFINITIONS: 'display.showAgentDefinitions',
  DISPLAY_SHOW_WORKFLOW_BARS: 'display.showWorkflowBars',
  DISPLAY_SHOW_SYNTAX_HIGHLIGHTING: 'display.showSyntaxHighlighting',
  DISPLAY_THEME: 'display.theme',
  DISPLAY_USER_PRESETS: 'display.userPresets',
  DISPLAY_FOLLOW_SYSTEM_THEME: 'display.followSystemTheme',
  DISPLAY_SYSTEM_THEME_PREFS: 'display.systemThemePrefs',
  DISPLAY_SHOW_OPEN_IN_EDITOR: 'display.showOpenInEditorLinks',
  DISPLAY_SHOW_CHANGELOG_ON_UPDATE: 'display.showChangelogOnUpdate',
  DISPLAY_MAX_VISIBLE_ITEMS: 'display.maxVisibleItems',
  DISPLAY_CUSTOM_CSS: 'display.customCss',
  DISPLAY_TERMINAL_FONT: 'display.terminalFont',
  DISPLAY_USE_NATIVE_SCROLLBARS: 'display.useNativeScrollbars',
  DISPLAY_USE_NATIVE_SCROLLBARS_CODE_BLOCKS: 'display.useNativeScrollbarsCodeBlocks',
  DISPLAY_COLLAPSE_LARGE_TOOL_CALLS: 'display.collapseLargeToolCalls',
  DISPLAY_DEFER_CODE_HIGHLIGHT_WHILE_STREAMING: 'display.deferCodeHighlightWhileStreaming',
  DISPLAY_FEED_VIRTUALIZATION: 'display.feedVirtualization',
  DISPLAY_MODEL_SELECTOR_HEIGHT: 'display.modelSelectorHeight',
  DISPLAY_COLLAPSE_PROVIDERS_BY_DEFAULT: 'display.collapseProvidersByDefault',
  DISPLAY_COLLAPSE_FAVORITES_BY_DEFAULT: 'display.collapseFavoritesByDefault',
  DISPLAY_MODEL_FAVORITES: 'display.modelFavorites',
  LLM_DYNAMIC_SYSTEM_PROMPT: 'llm.dynamicSystemPrompt',
  CACHE_WARMING: 'cache.warming',
  KEYBINDINGS: 'keybindings',
  RETRY_PATTERNS: 'agent.retryPatterns',
  SKILLS_DIRECTORIES: 'skills.directories',
  SEARCH_ENGINE: 'search.engine',
  SEARCH_TAVILY_API_KEY: 'search.tavilyApiKey',
  SEARCH_SEARXNG_URL: 'search.searxngUrl',
  SEARCH_SEARXNG_API_KEY: 'search.searxngApiKey',
  TOOLS_USE_RTK: 'tools.useRtk',
  TOOLS_SHELL: 'tools.shell',
  CONFIRM_ON_WORKSPACE_ACTIONS: 'tools.confirmOnWorkspaceActions',
  FEATURES_PER_SESSION_MCP: 'features.perSessionMcp',
  PROXY_URL: 'network.proxyUrl',
  DEFAULT_AGENT: 'agent.defaultAgent',
  FAVORITE_WORKFLOW: 'workflow.favoriteWorkflow',
  AUTO_ANSWER_QUESTIONS: 'agent.autoAnswerQuestions',
  AUTO_ACTION_TIMEOUT: 'agent.autoActionTimeoutSeconds',
} as const

export const DISPLAY_SETTINGS_KEYS = [
  SETTINGS_KEYS.DISPLAY_SHOW_THINKING,
  SETTINGS_KEYS.DISPLAY_SHOW_VERBOSE_TOOL_OUTPUT,
  SETTINGS_KEYS.DISPLAY_SHOW_STATS,
  SETTINGS_KEYS.DISPLAY_SHOW_AGENT_DEFINITIONS,
  SETTINGS_KEYS.DISPLAY_SHOW_WORKFLOW_BARS,
  SETTINGS_KEYS.DISPLAY_SHOW_SYNTAX_HIGHLIGHTING,
  SETTINGS_KEYS.DISPLAY_FOLLOW_SYSTEM_THEME,
  SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR,
  SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE,
  SETTINGS_KEYS.DISPLAY_MAX_VISIBLE_ITEMS,
  SETTINGS_KEYS.DISPLAY_TERMINAL_FONT,
  SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS,
  SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS_CODE_BLOCKS,
  SETTINGS_KEYS.DISPLAY_COLLAPSE_LARGE_TOOL_CALLS,
  SETTINGS_KEYS.DISPLAY_DEFER_CODE_HIGHLIGHT_WHILE_STREAMING,
  SETTINGS_KEYS.DISPLAY_FEED_VIRTUALIZATION,
] as const

export async function fetchChangelog(since?: string): Promise<string> {
  const url = since ? `/api/changelog?since=${encodeURIComponent(since)}` : '/api/changelog'
  const res = await authFetch(url)
  if (!res.ok) throw new Error(`Failed to load changelog (${res.status})`)
  const data = (await res.json()) as { content?: string }
  return data.content ?? ''
}

/** On-demand changelog markdown, keyed by the "since" trim boundary. */
export const changelogResource = resource<string, [string?]>({
  key: (since) => `changelog:${since ?? ''}`,
  fetch: fetchChangelog,
  maxAgeMs: 0,
})

/** Combined workspace config: file-based `setup` plus DB-backed `rootDir`/`mcpOverrides`. */
export interface WorkspaceConfigResponse extends SharedWorkspaceConfig {
  rootDir?: string
  mcpOverrides?: Record<string, { disabled?: boolean; disabledTools?: string[] }>
}

export async function fetchWorkspaceConfig(workdir: string): Promise<WorkspaceConfigResponse | null> {
  const res = await authFetch(`/api/workspace/config?workdir=${encodeURIComponent(workdir)}`)
  if (!res.ok) throw new Error(`Failed to load workspace config (${res.status})`)
  const data = (await res.json()) as { config?: WorkspaceConfigResponse | null }
  return data.config ?? null
}

/** Per-project workspace config, scoped by workdir. */
export const workspaceConfigResource = resource<WorkspaceConfigResponse | null, [string]>({
  key: (workdir) => `workspace-config:${workdir}`,
  fetch: fetchWorkspaceConfig,
  maxAgeMs: 60_000,
})

/** Save the workspace config: POST, then write the saved value through so
 * subscribers on the workdir key converge immediately (no follow-up GET). */
export async function saveWorkspaceConfig(workdir: string, config: WorkspaceConfigResponse): Promise<void> {
  const res = await authFetch(`/api/workspace/config?workdir=${encodeURIComponent(workdir)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
  if (!res.ok) throw new Error('Failed to save workspace config')
  const data = (await res.json()) as { config?: WorkspaceConfigResponse | null }
  workspaceConfigResource.write(data.config ?? config, workdir)
}

export interface WorkspaceInfo {
  path: string
  name: string
  branch: string | null
}

export async function fetchWorkspaces(projectId: string): Promise<WorkspaceInfo[]> {
  const res = await authFetch(`/api/projects/${projectId}/workspaces`)
  if (!res.ok) throw new Error(`Failed to load workspaces (${res.status})`)
  const data = (await res.json()) as { workspaces?: WorkspaceInfo[] }
  return data.workspaces ?? []
}

/** Per-project workspace list (shared clones). Modal-scoped read, fresh on open. */
export const workspacesResource = resource<WorkspaceInfo[], [string]>({
  key: (projectId) => `project-workspaces:${projectId}`,
  fetch: fetchWorkspaces,
  maxAgeMs: 0,
})

export interface SessionBranchesData {
  branches: Array<{ name: string; current: boolean }>
  defaultBranch: string
}

export async function fetchSessionBranches(sessionId: string): Promise<SessionBranchesData> {
  const res = await authFetch(`/api/sessions/${sessionId}/branches`)
  if (!res.ok) throw new Error(`Failed to load branches (${res.status})`)
  const data = (await res.json()) as { branches?: SessionBranchesData['branches']; defaultBranch?: string }
  return { branches: data.branches ?? [], defaultBranch: data.defaultBranch ?? '' }
}

/** Session git branches. Modal-scoped read, fresh on open. */
export const sessionBranchesResource = resource<SessionBranchesData, [string]>({
  key: (sessionId) => `session-branches:${sessionId}`,
  fetch: fetchSessionBranches,
  maxAgeMs: 0,
})

export interface ReadonlySessionData {
  session: import('@shared/types.js').Session | null
  messages: import('@shared/types.js').Message[]
  hiddenCount: number
}

export async function fetchReadonlySession(sessionId: string): Promise<ReadonlySessionData> {
  const res = await authFetch(`/api/sessions/${sessionId}?full=true`)
  if (!res.ok) throw new Error(`Failed to load session (${res.status})`)
  const data = (await res.json()) as Partial<ReadonlySessionData>
  return {
    session: data.session ?? null,
    messages: data.messages ?? [],
    hiddenCount: data.hiddenCount ?? 0,
  }
}

/** Read-only session view (full messages). Loaded on mount per session. */
export const readonlySessionResource = resource<ReadonlySessionData, [string]>({
  key: (sessionId) => `readonly-session:${sessionId}`,
  fetch: fetchReadonlySession,
  maxAgeMs: 0,
})

export interface BranchData {
  branch: string | null
  workdir: string
  error?: string
}

export async function fetchBranch(workdir: string): Promise<BranchData> {
  if (!workdir) return { branch: null, workdir: '' }
  const res = await authFetch(`/api/branch?workdir=${encodeURIComponent(workdir)}`)
  if (!res.ok) throw new Error(`Failed to fetch branch (${res.status})`)
  return (await res.json()) as BranchData
}

/** Current git branch per workdir, refreshed by the caller's poll loop. */
export const branchResource = resource<BranchData, [string]>({
  key: (workdir) => `branch:${workdir}`,
  fetch: fetchBranch,
  maxAgeMs: 0,
})

export async function fetchDevServerStatus(workdir: string): Promise<DevServerStatus> {
  const res = await authFetch(`/api/dev-server?workdir=${encodeURIComponent(workdir)}`)
  if (!res.ok) throw new Error(`Failed to load dev server status (${res.status})`)
  return (await res.json()) as DevServerStatus
}

/** Live dev-server status per workdir. WS `devServer.state` pushes write through. */
export const devServerStatusResource = resource<DevServerStatus, [string]>({
  key: (workdir) => `dev-server:status:${workdir}`,
  fetch: fetchDevServerStatus,
  maxAgeMs: 0,
})

export async function fetchDevServerConfig(workdir: string): Promise<DevServerConfig | null> {
  const res = await authFetch(`/api/dev-server/config?workdir=${encodeURIComponent(workdir)}`)
  if (!res.ok) throw new Error(`Failed to load dev server config (${res.status})`)
  const data = (await res.json()) as { config?: DevServerConfig | null }
  return data.config ?? null
}

/** Per-workdir `.openfox/dev.json` config; saves POST then write through. */
export const devServerConfigResource = resource<DevServerConfig | null, [string]>({
  key: (workdir) => `dev-server:config:${workdir}`,
  fetch: fetchDevServerConfig,
  maxAgeMs: 0,
})

/** Single agent detail, scoped by id + workdir. */
export async function fetchAgentDetail(agentId: string, workdir?: string): Promise<AgentFull | null> {
  const res = await authFetch(agentsUrl(`/api/agents/${agentId}`, workdir))
  if (!res.ok) return null
  return (await res.json()) as AgentFull
}

export const agentResource = resource<AgentFull | null, [string, string?]>({
  key: (agentId, workdir) => `agent:${agentId}:${workdir ?? ''}`,
  fetch: fetchAgentDetail,
  maxAgeMs: 0,
})

/** Built-in default agent content (duplicate-from-default source). */
export async function fetchAgentDefaultContent(agentId: string): Promise<AgentFull | null> {
  const res = await authFetch(`/api/agents/defaults/${agentId}`)
  if (!res.ok) return null
  return (await res.json()) as AgentFull
}

export const agentDefaultResource = resource<AgentFull | null, [string]>({
  key: (agentId) => `agent-default:${agentId}`,
  fetch: fetchAgentDefaultContent,
  maxAgeMs: 0,
})
