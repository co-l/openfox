import { which } from '../utils/which.js'
import type { Diagnostic } from '../../shared/types.js'
import type { LanguageConfig, LspManagerInterface } from './types.js'
import { LspServer } from './server.js'
import { detectLanguage } from './languages.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// LSP Manager
// ============================================================================

/**
 * Manages multiple LSP servers for a session.
 * Lazy-starts servers on first file access for each language.
 */
export class LspManager implements LspManagerInterface {
  private workdir: string
  private sessionId: string
  private servers = new Map<string, LspServer>()  // language id -> server
  private unavailableServers = new Set<string>()  // language ids we've tried and failed
  private serverPromises = new Map<string, Promise<LspServer | null>>()  // pending server starts
  
  constructor(workdir: string, sessionId: string) {
    this.workdir = workdir
    this.sessionId = sessionId
  }
  
  // ============================================================================
  // Server Management
  // ============================================================================
  
  private async getOrCreateServer(config: LanguageConfig): Promise<LspServer | null> {
    const langId = config.id
    
    // Already have a running server?
    const existing = this.servers.get(langId)
    if (existing?.isRunning()) {
      return existing
    }
    
    // Already known to be unavailable?
    if (this.unavailableServers.has(langId)) {
      return null
    }
    
    // Already starting?
    const pending = this.serverPromises.get(langId)
    if (pending) {
      return pending
    }
    
    // Start a new server
    const promise = this.startServer(config)
    this.serverPromises.set(langId, promise)
    
    try {
      const server = await promise
      return server
    } finally {
      this.serverPromises.delete(langId)
    }
  }
  
  private async startServer(config: LanguageConfig): Promise<LspServer | null> {
    const langId = config.id
    
    // Check if command exists (checks bundled, project-local, then system PATH)
    const commandPath = await which(config.serverCommand, this.workdir)
    if (!commandPath) {
      logger.warn('LSP server not installed, skipping', {
        language: langId,
        command: config.serverCommand,
        sessionId: this.sessionId,
      })
      this.unavailableServers.add(langId)
      return null
    }
    
    // Create and start server with resolved command path
    const server = new LspServer(config, this.workdir, commandPath)
    
    try {
      await server.start()
      this.servers.set(langId, server)
      
      logger.debug('LSP server started for session', {
        language: langId,
        sessionId: this.sessionId,
      })
      
      return server
    } catch (error) {
      logger.warn('Failed to start LSP server', {
        language: langId,
        error: error instanceof Error ? error.message : String(error),
        sessionId: this.sessionId,
      })
      this.unavailableServers.add(langId)
      return null
    }
  }
  
  private async getServerForFile(path: string): Promise<LspServer | null> {
    const config = detectLanguage(path)
    if (!config) {
      return null
    }
    
    return this.getOrCreateServer(config)
  }
  
  // ============================================================================
  // Public Interface
  // ============================================================================
  
  /**
   * Notify LSP that a file has changed and get diagnostics.
   * This is the main entry point for tools like write_file and edit_file.
   */
  async notifyFileChange(path: string, content: string): Promise<Diagnostic[]> {
    const server = await this.getServerForFile(path)
    if (!server) {
      return []
    }
    
    try {
      // Send the change to LSP
      await server.didChange(path, content)
      
      // Wait for and return diagnostics
      const diagnostics = await server.getDiagnosticsWithWait(path)
      
      return diagnostics
    } catch (error) {
      logger.error('Error notifying LSP of file change', {
        path,
        error: error instanceof Error ? error.message : String(error),
        sessionId: this.sessionId,
      })
      return []
    }
  }
  
  /**
   * Get current diagnostics for a file without triggering a change.
   */
  getDiagnostics(path: string): Diagnostic[] {
    const config = detectLanguage(path)
    if (!config) {
      return []
    }
    
    const server = this.servers.get(config.id)
    if (!server?.isRunning()) {
      return []
    }
    
    return server.getDiagnostics(path)
  }
  
  /**
   * Check if LSP is available for a given file type.
   * Returns true if we have or can start a server for this file type.
   */
  isAvailableFor(path: string): boolean {
    const config = detectLanguage(path)
    if (!config) {
      return false
    }
    
    // Check if we know it's unavailable
    if (this.unavailableServers.has(config.id)) {
      return false
    }
    
    // We have a server or can potentially start one
    return true
  }
  
  /**
   * Shutdown all LSP servers.
   */
  async shutdown(): Promise<void> {
    const shutdownPromises: Promise<void>[] = []
    
    for (const server of this.servers.values()) {
      shutdownPromises.push(server.stop())
    }
    
    await Promise.all(shutdownPromises)
    
    this.servers.clear()
    this.unavailableServers.clear()
    this.serverPromises.clear()
    
    logger.debug('LSP manager shutdown complete', { sessionId: this.sessionId })
  }
  
  /**
   * Get status of all servers.
   */
  getStatus(): { language: string; state: string }[] {
    return Array.from(this.servers.entries()).map(([lang, server]) => ({
      language: lang,
      state: server.getState(),
    }))
  }
}

// ============================================================================
// Session LSP Manager Registry
// ============================================================================

const sessionManagers = new Map<string, LspManager>()

/**
 * Get or create an LSP manager for a session.
 */
export function getLspManager(sessionId: string, workdir: string): LspManager {
  let manager = sessionManagers.get(sessionId)
  if (!manager) {
    manager = new LspManager(workdir, sessionId)
    sessionManagers.set(sessionId, manager)
  }
  return manager
}

/**
 * Shutdown and remove LSP manager for a session.
 */
export async function shutdownLspManager(sessionId: string): Promise<void> {
  const manager = sessionManagers.get(sessionId)
  if (manager) {
    await manager.shutdown()
    sessionManagers.delete(sessionId)
  }
}

/**
 * Shutdown all LSP managers.
 */
export async function shutdownAllLspManagers(): Promise<void> {
  const promises: Promise<void>[] = []
  for (const manager of sessionManagers.values()) {
    promises.push(manager.shutdown())
  }
  await Promise.all(promises)
  sessionManagers.clear()
}
