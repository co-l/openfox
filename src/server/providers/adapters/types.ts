import type { ModelConfig } from '../../../shared/types.js'
import type { LLMCompletionRequest, LLMCompletionResponse, LLMStreamEvent } from '../../llm/types.js'

export type ProviderAuthState = 'disconnected' | 'pending' | 'connected' | 'expired' | 'error'

export interface ProviderAuthStatus {
  state: ProviderAuthState
  accountLabel?: string
  error?: string
}

export interface ProviderLoginChallenge {
  url: string
  instructions: string
  mode: 'browser' | 'device'
}

export interface ProviderAccessContext {
  accessToken?: string
  accountId?: string
  headers?: Record<string, string>
}

export interface ProviderAuthAdapter {
  readonly id: string
  getStatus(credentialRef?: string): Promise<ProviderAuthStatus>
  beginLogin(): Promise<ProviderLoginChallenge>
  getAccessContext(credentialRef: string): Promise<ProviderAccessContext>
  logout(credentialRef: string): Promise<void>
}

export interface ProviderRequestContext {
  providerId: string
  credentialRef?: string
  auth?: ProviderAccessContext
  /** Model identifier sent to the provider. */
  model?: string
  /** OpenFox catalog identifier used for display and statistics. */
  catalogModel?: string
  /** Catalog-defined top-level request fields for the selected model mode. */
  requestBody?: Record<string, unknown>
}

export interface ProviderTransportAdapter {
  readonly id: string
  listModels(context: ProviderRequestContext): Promise<ModelConfig[]>
  complete(request: LLMCompletionRequest, context: ProviderRequestContext): Promise<LLMCompletionResponse>
  stream(request: LLMCompletionRequest, context: ProviderRequestContext): AsyncIterable<LLMStreamEvent>
}
