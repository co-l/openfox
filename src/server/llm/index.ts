export { createLLMClient, type LLMClientWithModel } from './client.js'
export {
  detectModel,
  getCachedModel,
  clearModelCache,
  getModelInfo,
  getLlmStatus,
  setLlmStatus,
  type LlmStatus,
  type LlmModel,
} from './models.js'
export { getModelProfile, modelSupportsReasoning, type ModelProfile } from './profiles.js'
export {
  streamWithSegments,
  SegmentBuilder,
  type StreamEvent,
  type StreamResult,
  type StreamTiming,
} from './streaming.js'
export {
  detectBackend,
  getBackendCapabilities,
  getBackendDisplayName,
  type Backend,
  type BackendCapabilities,
} from './backend.js'
export type {
  LLMClient,
  LLMMessage,
  LLMToolDefinition,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamEvent,
} from './types.js'
