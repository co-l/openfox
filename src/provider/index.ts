import type { ModelConfig } from '../shared/types.js'
import type { LLMCompletionRequest, LLMCompletionResponse, LLMStreamEvent } from '../server/llm/types.js'

// ============================================================================
// Auth Types
// ============================================================================

export type ProviderAuthState = 'disconnected' | 'pending' | 'connected' | 'expired' | 'error'

export interface ProviderAuthStatus {
  state: ProviderAuthState
  accountLabel?: string
  error?: string
}

export interface ProviderLoginChallenge {
  mode: 'device' | 'browser' | 'external'
  verificationUrl: string
  directUrl?: string
  userCode?: string
  instructions: string
  expiresAt?: string
  intervalSeconds?: number
}

export interface ProviderLoginResult {
  credentialRef: string
}

export interface ProviderAccessContext {
  accessToken?: string
  accountId?: string
  headers?: Record<string, string>
}

// ============================================================================
// Adapter Interfaces (public contract for plugins)
// ============================================================================

export interface ProviderAuthAdapter {
  readonly id: string
  beginLogin(context: { providerId: string }): Promise<{
    challenge: ProviderLoginChallenge
    completion: Promise<ProviderLoginResult>
  }>
  getStatus(context: { providerId: string; credentialRef?: string }): Promise<ProviderAuthStatus>
  getAccessContext(credentialRef: string): Promise<ProviderAccessContext>
  logout(credentialRef: string): Promise<void>
}

export interface ProviderRequestContext {
  providerId: string
  credentialRef?: string
  auth?: ProviderAccessContext
  model?: string
  catalogModel?: string
  requestBody?: Record<string, unknown>
}

export interface ProviderTransportAdapter {
  readonly id: string
  listModels(context: ProviderRequestContext): Promise<ModelConfig[]>
  complete(request: LLMCompletionRequest, context: ProviderRequestContext): Promise<LLMCompletionResponse>
  stream(request: LLMCompletionRequest, context: ProviderRequestContext): AsyncIterable<LLMStreamEvent>
}

// ============================================================================
// Preset Types
// ============================================================================

/** Describes a provider preset shown in the UI setup wizard. */
export interface ProviderPreset {
  id: string
  name: string
  description: string
  documentationUrl?: string
  requiresAuth: boolean
  authAdapter?: string
  transportAdapter?: string
  defaults: {
    name?: string
    url: string
    backend: string
    models?: ModelConfig[]
  }
  connectLabel?: string
  disconnectLabel?: string
  missingPluginMessage?: string
}

// ============================================================================
// Plugin Runtime
// ============================================================================

export interface ProviderPluginRuntime {
  readonly mode: 'production' | 'development'
  readonly configDirectory: string
}

// ============================================================================
// Plugin Registry (passed to plugins during registration)
// ============================================================================

export interface ProviderPluginRegistry {
  registerAuth(adapter: ProviderAuthAdapter): void
  registerTransport(adapter: ProviderTransportAdapter): void
  registerPreset(preset: ProviderPreset): void
  readonly runtime: ProviderPluginRuntime
}

// ============================================================================
// Plugin Manifest & Entry Point
// ============================================================================

/** Describes an auth adapter contributed by a plugin (for UI metadata). */
export interface PluginAuthDescriptor {
  id: string
  label: string
  authUI?: {
    type: 'device' | 'oauth' | 'api-key'
    instructions?: string
    connectLabel?: string
    disconnectLabel?: string
  }
}

/** Describes a transport adapter contributed by a plugin. */
export interface PluginTransportDescriptor {
  id: string
  label: string
}

/** A provider plugin manifest describes everything a plugin contributes. */
export interface ProviderPluginManifest {
  /** Unique plugin ID (npm package name). */
  id: string
  /** Human-readable name. */
  name: string
  /** Semver version string. */
  version: string
  /** Auth adapters this plugin provides. */
  authAdapters: PluginAuthDescriptor[]
  /** Transport adapters this plugin provides. */
  transportAdapters: PluginTransportDescriptor[]
}

/** A provider plugin registers adapters and presets with the runtime. */
export interface ProviderPlugin {
  readonly manifest: ProviderPluginManifest
  register(registry: ProviderPluginRegistry): void
}

// ============================================================================
// Adapter Metadata (for UI rendering)
// ============================================================================

/** Frontend-facing metadata for a registered adapter. */
export interface ProviderAdapterMeta {
  id: string
  kind: 'auth' | 'transport'
  label: string
  authUI?: PluginAuthDescriptor['authUI']
}

export type {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMMessage,
  LLMStreamEvent,
  LLMToolDefinition,
} from '../server/llm/types.js'
export type { ModelConfig, ToolCall } from '../shared/types.js'
