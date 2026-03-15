// LSP Integration
// Provides language server protocol support for real-time diagnostics

export { LspServer } from './server.js'
export { LspManager, getLspManager, shutdownLspManager, shutdownAllLspManagers } from './manager.js'
export { detectLanguage, getSupportedLanguages, getLanguageById, LANGUAGES } from './languages.js'
export type { LanguageConfig, LspServerState, LspServerStatus, LspManagerInterface } from './types.js'
