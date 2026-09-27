import { z } from 'zod'
import type { ModelConfig, Provider } from '../shared/types.js'
import type {
  LocalizedString,
  PluginBadgeTone,
  PluginCapability,
  PluginNotificationAction,
  PluginSettingsSchema,
  PluginSettingsTab,
  PluginSettingValue,
  PluginUiAction,
  PluginUiBadge,
  PluginUiComponent,
  PluginUiOverride,
  PluginUiPanel,
} from '../shared/plugin.js'
import type {
  ProviderAccessContext,
  ProviderAuthAdapter,
  ProviderLoginChallenge,
  ProviderLoginResult,
  ProviderPreset,
  ProviderRequestContext,
  ProviderTransportAdapter,
} from '../provider/index.js'

export type {
  DeclarativeNode,
  LocalizedString,
  PluginActivation,
  PluginCapability,
  PluginContributionSummary,
  PluginInfo,
  PluginNotification,
  PluginNotificationAction,
  PluginSettingsField,
  PluginSettingsSchema,
  PluginSettingsTab,
  PluginSettingScope,
  PluginSettingValue,
  PluginSettingsValues,
  PluginSlotName,
  PluginZoneId,
  PluginUiAction,
  PluginUiBadge,
  PluginUiBadgeAppearance,
  PluginUiBadgeCacheScope,
  PluginUiBadgeDynamicState,
  PluginUiBadgeRpcSource,
  PluginUiComponent,
  PluginUiContributions,
  PluginUiOverride,
  PluginUiPanel,
  PluginUiSection,
  PluginVisibilityCondition,
} from '../shared/plugin.js'

export type {
  ProviderAccessContext,
  ProviderAuthAdapter,
  ProviderLoginChallenge,
  ProviderLoginResult,
  ProviderPreset,
  ProviderRequestContext,
  ProviderTransportAdapter,
}

export const PLUGIN_API_VERSION = 2

export const pluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  openfox: z.object({
    apiVersion: z.number().int(),
    entry: z.string().min(1).optional(),
    plugin: z.string().min(1).optional(),
    displayName: z.string().min(1).optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    logo: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
})

export interface PluginManifest {
  name: string
  version: string
  openfox: {
    apiVersion: number
    entry?: string
    plugin?: string
    displayName?: string
    description?: string
    icon?: string
    logo?: string
    capabilities?: PluginCapability[]
    timeoutMs?: number
  }
}

export interface PluginRuntime {
  readonly mode: 'production' | 'development'
  readonly configDirectory: string
}

export interface PluginToolContext {
  sessionId: string
  workdir: string
  projectId?: string
  signal?: AbortSignal
}

export interface PluginToolResult {
  success: boolean
  output?: string
  error?: string
}

export interface PluginTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute(args: Record<string, unknown>, context: PluginToolContext): Promise<PluginToolResult>
}

export interface PluginCommand {
  id: string
  name: string
  prompt: string
  agentMode?: string
}

export interface PluginSkill {
  id: string
  name: string
  description: string
  prompt: string
  group?: string
}

export interface PluginSkillSource {
  id: string
  label: LocalizedString
  load(): Promise<PluginSkill[]> | PluginSkill[]
}

export interface PluginModelMetadata {
  contextWindow?: number
  vision?: boolean
  reasoning?: boolean
  nameTone?: PluginBadgeTone
  popover?: import('../shared/plugin.js').PluginModelPopoverView
  subline?: import('../shared/plugin.js').PluginModelSublineItem[]
  bottomSubline?: import('../shared/plugin.js').PluginModelSublineItem[]
  badges?: { label: LocalizedString; tone?: PluginBadgeTone }[]
  extra?: Record<string, unknown>
}

export type {
  PluginModelMetadataView,
  PluginModelPopoverRow,
  PluginModelPopoverView,
  PluginModelSublineItem,
  PluginModelBadge,
} from '../shared/plugin.js'

export interface PluginModelMetadataProvider {
  id: string
  getMetadata(context: {
    providerId: string
    modelId: string
    model: ModelConfig
  }): PluginModelMetadata | undefined | Promise<PluginModelMetadata | undefined>
  getProviderMetadata?(context: {
    providerId: string
    provider?: Provider
  }): PluginModelMetadata | undefined | Promise<PluginModelMetadata | undefined>
}

export type PluginHookEvent =
  | 'session.created'
  | 'turn.completed'
  | 'workflow.step.completed'
  | 'workflow.execution.changed'
  | 'task.completed'
  | 'message.created'
  | 'tool.completed'
  | 'llm.completed'
  | 'criterion.updated'
  | 'provider.changed'
  | 'devserver.started'
  | 'devserver.stopped'
  | 'devserver.state.changed'
  // OpenFox-internal events emitted by the runtime; plugins can observe
  // them via `registerHook`. They mirror the underlying TurnEvent names
  // (see src/server/events/types.ts) so plugins can correlate hook
  // payloads with the session's EventStore stream.
  //
  // Sub-agent activity is derived server-side from `message.start` and
  // `message.done` events carrying `subAgentId`/`subAgentType` — exposed
  // via `SessionStatsEventRollup.subAgentCalls` rather than a separate
  // plugin hook. This keeps the hook surface small.
  | 'context.compacted'
  | 'retry.triggered'

export interface PluginHookPayload {
  event: PluginHookEvent
  sessionId: string
  projectId?: string
  timestamp: string
  data: Record<string, unknown>
}

export type PluginHookHandler = (payload: PluginHookPayload) => void | Promise<void>

export interface PluginNotificationRequest {
  title: LocalizedString
  body?: LocalizedString
  level?: 'info' | 'success' | 'warning' | 'error'
  actions?: PluginNotificationAction[]
}

export type PluginRpcHandler = (
  params: Record<string, unknown>,
  context: PluginToolContext,
) => unknown | Promise<unknown>

export interface PluginStorage {
  get(key: string): PluginSettingValue | undefined
  set(key: string, value: PluginSettingValue): void
}

export interface PluginLogger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
}

export interface PluginContext {
  readonly id: string
  readonly version: string
  readonly runtime: PluginRuntime
  readonly logger: PluginLogger
  readonly storage: PluginStorage
  settings(scope?: 'global' | 'project', projectId?: string): Record<string, PluginSettingValue>
  notify(request: PluginNotificationRequest): void
  publish(panelId: string | undefined, key: string, value: unknown): void
}

export interface PluginRegistry {
  readonly runtime: PluginRuntime
  readonly context: PluginContext

  registerAuth(adapter: ProviderAuthAdapter): void
  registerTransport(adapter: ProviderTransportAdapter): void
  registerPreset(preset: ProviderPreset): void

  registerModelMetadataProvider(provider: PluginModelMetadataProvider): void
  registerTool(tool: PluginTool): void
  registerCommand(command: PluginCommand): void
  registerSkillSource(source: PluginSkillSource): void
  registerSettings(schema: PluginSettingsSchema): void
  registerUiAction(action: PluginUiAction): void
  registerUiBadge(badge: PluginUiBadge): void
  registerUiPanel(panel: PluginUiPanel): void
  registerSettingsTab(tab: PluginSettingsTab): void
  registerUiComponent(component: PluginUiComponent): void
  registerUiOverride(override: PluginUiOverride): void
  registerHook(event: PluginHookEvent, handler: PluginHookHandler): void
  registerTransitionHandler(
    name: string,
    handler: (context: PluginTransitionContext) => boolean | Promise<boolean>,
  ): void
  registerRpc(method: string, handler: PluginRpcHandler): void
  registerAsset(relativePath: string): void
}

export interface PluginTransitionContext {
  workflowId?: string
  stepId?: string
  config?: unknown
  outcome: { result: string; output: Record<string, string> } | null
  metadataEntries?: Record<string, { [field: string]: unknown }[]>
}

export interface PluginDefinition {
  register(registry: PluginRegistry): void | Promise<void>
  deactivate?(): void | Promise<void>
}

export type {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMMessage,
  LLMStreamEvent,
  LLMToolDefinition,
} from '../server/llm/types.js'
export type { ModelConfig, ToolCall, Provider } from '../shared/types.js'
export type { ProviderPluginRegistry } from '../provider/index.js'
