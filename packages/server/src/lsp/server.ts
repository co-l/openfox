import { spawn, type ChildProcess } from 'node:child_process'
import { extname } from 'node:path'
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js'
import type { MessageConnection } from 'vscode-jsonrpc'
import type { Diagnostic } from '@openfox/shared'
import type { LanguageConfig, LspServerState } from './types.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// LSP Protocol Constants & Types (minimal definitions)
// ============================================================================

// LSP method names
const LSP = {
  initialize: 'initialize',
  initialized: 'initialized',
  shutdown: 'shutdown',
  exit: 'exit',
  didOpen: 'textDocument/didOpen',
  didChange: 'textDocument/didChange',
  didClose: 'textDocument/didClose',
  publishDiagnostics: 'textDocument/publishDiagnostics',
} as const

// LSP diagnostic severity
const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const

type DiagnosticSeverityValue = (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity]

// LSP types
interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

interface LspDiagnostic {
  range: LspRange
  severity?: DiagnosticSeverityValue
  code?: number | string
  source?: string
  message: string
}

interface PublishDiagnosticsParams {
  uri: string
  diagnostics: LspDiagnostic[]
}

// ============================================================================
// Constants
// ============================================================================

const DIAGNOSTIC_WAIT_MS = 2000

// Map LSP severity to our severity
function mapSeverity(severity: DiagnosticSeverityValue | undefined): Diagnostic['severity'] {
  switch (severity) {
    case DiagnosticSeverity.Error: return 'error'
    case DiagnosticSeverity.Warning: return 'warning'
    case DiagnosticSeverity.Information: return 'info'
    case DiagnosticSeverity.Hint: return 'hint'
    default: return 'info'
  }
}

// ============================================================================
// LSP Server
// ============================================================================

export class LspServer {
  private config: LanguageConfig
  private workdir: string
  private process: ChildProcess | null = null
  private connection: MessageConnection | null = null
  private state: LspServerState = 'stopped'
  
  // Document tracking
  private openDocuments = new Map<string, { version: number; content: string }>()
  
  // Diagnostics storage
  private diagnostics = new Map<string, Diagnostic[]>()
  private diagnosticsCallbacks = new Set<(path: string, diagnostics: Diagnostic[]) => void>()
  
  // Pending diagnostic waiters
  private pendingDiagnostics = new Map<string, {
    resolve: (diagnostics: Diagnostic[]) => void
    timeout: NodeJS.Timeout
  }>()
  
  private commandPath: string
  
  constructor(config: LanguageConfig, workdir: string, commandPath?: string) {
    this.config = config
    this.workdir = workdir
    this.commandPath = commandPath ?? config.serverCommand
  }
  
  // ============================================================================
  // Lifecycle
  // ============================================================================
  
  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      return
    }
    
    this.state = 'starting'
    
    try {
      // Spawn the language server process using resolved command path
      this.process = spawn(this.commandPath, this.config.serverArgs, {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HOME: process.env['HOME'],
          PATH: process.env['PATH'],
        },
      })
      
      if (!this.process.stdin || !this.process.stdout) {
        throw new Error('Failed to get stdio streams from language server process')
      }
      
      // Set up JSON-RPC connection
      this.connection = createMessageConnection(
        new StreamMessageReader(this.process.stdout),
        new StreamMessageWriter(this.process.stdin)
      )
      
      // Handle diagnostics
      this.connection.onNotification(
        LSP.publishDiagnostics,
        (params: PublishDiagnosticsParams) => {
          this.handleDiagnostics(params)
        }
      )
      
      // Handle process errors
      this.process.on('error', (err) => {
        logger.error('LSP server process error', { language: this.config.id, error: err.message })
        this.handleProcessExit()
      })
      
      this.process.on('exit', (code) => {
        if (this.state === 'running') {
          logger.warn('LSP server exited unexpectedly', { language: this.config.id, code })
          this.handleProcessExit()
        }
      })
      
      this.process.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        if (msg) {
          logger.debug('LSP server stderr', { language: this.config.id, message: msg })
        }
      })
      
      // Start the connection
      this.connection.listen()
      
      // Send initialize request
      const initParams = {
        processId: process.pid,
        rootUri: `file://${this.workdir}`,
        rootPath: this.workdir,
        capabilities: {
          textDocument: {
            publishDiagnostics: {
              relatedInformation: true,
            },
            synchronization: {
              willSave: false,
              didSave: true,
              willSaveWaitUntil: false,
            },
          },
          workspace: {
            workspaceFolders: true,
          },
        },
        workspaceFolders: [
          { uri: `file://${this.workdir}`, name: 'workspace' }
        ],
        initializationOptions: this.config.initOptions,
      }
      
      const result = await this.connection.sendRequest(LSP.initialize, initParams)
      
      logger.debug('LSP server initialized', {
        language: this.config.id,
        capabilities: result,
      })
      
      // Send initialized notification
      await this.connection.sendNotification(LSP.initialized, {})
      
      this.state = 'running'
      
      logger.info('LSP server started', {
        language: this.config.id,
        pid: this.process.pid,
      })
      
    } catch (error) {
      this.state = 'error'
      logger.error('Failed to start LSP server', {
        language: this.config.id,
        command: this.config.serverCommand,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
  
  async stop(): Promise<void> {
    if (this.state === 'stopped') {
      return
    }
    
    // Clear pending waiters
    for (const [, waiter] of this.pendingDiagnostics) {
      clearTimeout(waiter.timeout)
      waiter.resolve([])
    }
    this.pendingDiagnostics.clear()
    
    if (this.connection && this.state === 'running') {
      try {
        await this.connection.sendRequest(LSP.shutdown)
        await this.connection.sendNotification(LSP.exit)
      } catch {
        // Ignore errors during shutdown
      }
    }
    
    // Force kill if still running
    if (this.process) {
      this.process.kill('SIGTERM')
      this.process = null
    }
    
    this.connection?.dispose()
    this.connection = null
    this.state = 'stopped'
    this.openDocuments.clear()
    this.diagnostics.clear()
    
    logger.info('LSP server stopped', { language: this.config.id })
  }
  
  private handleProcessExit(): void {
    this.state = 'error'
    this.connection?.dispose()
    this.connection = null
    this.process = null
    
    // Clear pending waiters
    for (const [, waiter] of this.pendingDiagnostics) {
      clearTimeout(waiter.timeout)
      waiter.resolve([])
    }
    this.pendingDiagnostics.clear()
  }
  
  // ============================================================================
  // Document Synchronization
  // ============================================================================
  
  async didOpen(path: string, content: string): Promise<void> {
    if (this.state !== 'running' || !this.connection) {
      return
    }
    
    // Already open? Send change instead
    const existing = this.openDocuments.get(path)
    if (existing) {
      await this.didChange(path, content)
      return
    }
    
    const uri = `file://${path}`
    const languageId = this.getLanguageIdForFile(path)
    
    this.openDocuments.set(path, { version: 1, content })
    
    await this.connection.sendNotification(LSP.didOpen, {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content,
      },
    })
  }
  
  /**
   * Get the correct LSP languageId for a file path.
   * Uses extension-specific mapping if available, otherwise falls back to config id.
   */
  private getLanguageIdForFile(path: string): string {
    if (this.config.languageIds) {
      const ext = extname(path).toLowerCase()
      const languageId = this.config.languageIds[ext]
      if (languageId) {
        return languageId
      }
    }
    return this.config.id
  }
  
  async didChange(path: string, content: string): Promise<void> {
    if (this.state !== 'running' || !this.connection) {
      return
    }
    
    const uri = `file://${path}`
    const existing = this.openDocuments.get(path)
    
    if (!existing) {
      await this.didOpen(path, content)
      return
    }
    
    const newVersion = existing.version + 1
    this.openDocuments.set(path, { version: newVersion, content })
    
    // Clear cached diagnostics - we want fresh ones after this change
    this.diagnostics.delete(path)
    
    await this.connection.sendNotification(LSP.didChange, {
      textDocument: {
        uri,
        version: newVersion,
      },
      contentChanges: [{ text: content }],
    })
  }
  
  async didClose(path: string): Promise<void> {
    if (this.state !== 'running' || !this.connection) {
      return
    }
    
    if (!this.openDocuments.has(path)) {
      return
    }
    
    const uri = `file://${path}`
    this.openDocuments.delete(path)
    
    await this.connection.sendNotification(LSP.didClose, {
      textDocument: { uri },
    })
  }
  
  // ============================================================================
  // Diagnostics
  // ============================================================================
  
  private handleDiagnostics(params: PublishDiagnosticsParams): void {
    // Convert URI to path
    const path = params.uri.replace(/^file:\/\//, '')
    
    // Convert LSP diagnostics to our format
    const diagnostics: Diagnostic[] = params.diagnostics.map(d => ({
      path,
      range: {
        start: { line: d.range.start.line, character: d.range.start.character },
        end: { line: d.range.end.line, character: d.range.end.character },
      },
      severity: mapSeverity(d.severity),
      message: d.message,
      source: d.source ?? this.config.id,
      ...(d.code !== undefined && { code: String(d.code) }),
    }))
    
    // Store diagnostics
    this.diagnostics.set(path, diagnostics)
    
    // Notify callbacks
    for (const callback of this.diagnosticsCallbacks) {
      callback(path, diagnostics)
    }
    
    // Resolve any pending waiters for this path
    const waiter = this.pendingDiagnostics.get(path)
    if (waiter) {
      clearTimeout(waiter.timeout)
      this.pendingDiagnostics.delete(path)
      waiter.resolve(diagnostics)
    }
  }
  
  /**
   * Get diagnostics for a file, waiting for LSP to respond if needed
   */
  async getDiagnosticsWithWait(path: string, timeoutMs: number = DIAGNOSTIC_WAIT_MS): Promise<Diagnostic[]> {
    // Return cached if available and we already have this file open
    if (this.openDocuments.has(path)) {
      return new Promise<Diagnostic[]>((resolve) => {
        // Check if we already have diagnostics
        const existing = this.diagnostics.get(path)
        if (existing !== undefined) {
          // Give a brief moment for any pending updates
          setTimeout(() => {
            resolve(this.diagnostics.get(path) ?? [])
          }, 100)
          return
        }
        
        // Wait for diagnostics
        const timeout = setTimeout(() => {
          this.pendingDiagnostics.delete(path)
          resolve(this.diagnostics.get(path) ?? [])
        }, timeoutMs)
        
        this.pendingDiagnostics.set(path, { resolve, timeout })
      })
    }
    
    return this.diagnostics.get(path) ?? []
  }
  
  /**
   * Get current diagnostics for a file (no waiting)
   */
  getDiagnostics(path: string): Diagnostic[] {
    return this.diagnostics.get(path) ?? []
  }
  
  /**
   * Subscribe to diagnostic updates
   */
  onDiagnostics(callback: (path: string, diagnostics: Diagnostic[]) => void): () => void {
    this.diagnosticsCallbacks.add(callback)
    return () => this.diagnosticsCallbacks.delete(callback)
  }
  
  // ============================================================================
  // Status
  // ============================================================================
  
  isRunning(): boolean {
    return this.state === 'running'
  }
  
  getState(): LspServerState {
    return this.state
  }
  
  getLanguage(): string {
    return this.config.id
  }
}
