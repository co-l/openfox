import type { Diagnostic } from '../../shared/types.js'

// ============================================================================
// Language Configuration
// ============================================================================

export interface LanguageConfig {
  id: string
  name: string
  extensions: string[]
  serverCommand: string
  serverArgs: string[]
  rootPatterns: string[] // Files that indicate project root for this language
  initOptions?: Record<string, unknown>
  /** Map file extension to LSP languageId (e.g., '.tsx' -> 'typescriptreact') */
  languageIds?: Record<string, string>
}

// ============================================================================
// LSP Server State
// ============================================================================

export type LspServerState = 'stopped' | 'starting' | 'running' | 'error'

export interface LspServerStatus {
  state: LspServerState
  language: string
  pid?: number
  error?: string
}

// ============================================================================
// Diagnostic Collection
// ============================================================================

export interface DiagnosticCollection {
  path: string
  diagnostics: Diagnostic[]
  timestamp: number
}

// ============================================================================
// LSP Manager Interface
// ============================================================================

export interface LspManagerInterface {
  /**
   * Notify the LSP that a file has changed and get diagnostics
   * Returns diagnostics for the file (may be empty if no issues)
   */
  notifyFileChange(path: string, content: string): Promise<Diagnostic[]>

  /**
   * Get current diagnostics for a file without triggering a change
   */
  getDiagnostics(path: string): Diagnostic[]

  /**
   * Check if LSP is available for a given file
   */
  isAvailableFor(path: string): boolean

  /**
   * Shutdown all LSP servers
   */
  shutdown(): Promise<void>
}
