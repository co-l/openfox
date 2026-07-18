import { spawn, type ChildProcess } from 'node:child_process'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node.js'
import type { MessageConnection } from 'vscode-jsonrpc'
import type { Diagnostic } from '../../shared/types.js'
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
  definition: 'textDocument/definition',
  references: 'textDocument/references',
  typeDefinition: 'textDocument/typeDefinition',
  hover: 'textDocument/hover',
  workspaceSymbol: 'workspace/symbol',
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

// LSP location types for code navigation
interface LspLocation {
  uri: string
  range: LspRange
}

interface LspSymbolInfo {
  name: string
  kind: number
  location: LspLocation
  containerName?: string
}

interface LspHoverContents {
  kind: string
  value: string
}

interface LspHover {
  contents: LspHoverContents | LspHoverContents[] | string
  range?: LspRange
}

// ============================================================================
// Exported types for code navigation
// ============================================================================

export interface CodeLocation {
  path: string
  line: number
  character: number
  endLine: number
  endCharacter: number
}

export interface SymbolInfo {
  name: string
  kind: string
  location: CodeLocation
  containerName?: string
}

export interface HoverInfo {
  contents: string
  range?: { start: { line: number; character: number }; end: { line: number; character: number } }
}

/**
 * Helper to build a HoverInfo with optional range.
 * Needed because exactOptionalPropertyTypes prevents spreading `range: undefined`.
 */
function hoverInfo(contents: string, range?: HoverInfo['range']): HoverInfo {
  return range ? { contents, range } : { contents }
}

// ============================================================================
// Constants
// ============================================================================

const DIAGNOSTIC_WAIT_MS = 2000

// LSP SymbolKind number to human-readable string
// See https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolKind
const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: 'File',
  2: 'Module',
  3: 'Namespace',
  4: 'Package',
  5: 'Class',
  6: 'Method',
  7: 'Property',
  8: 'Field',
  9: 'Constructor',
  10: 'Enum',
  11: 'Interface',
  12: 'Function',
  13: 'Variable',
  14: 'Constant',
  15: 'String',
  16: 'Number',
  17: 'Boolean',
  18: 'Array',
  19: 'Object',
  20: 'Key',
  21: 'Null',
  22: 'EnumMember',
  23: 'Struct',
  24: 'Event',
  25: 'Operator',
  26: 'TypeParameter',
}

// Map LSP severity to our severity
function mapSeverity(severity: DiagnosticSeverityValue | undefined): Diagnostic['severity'] {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return 'error'
    case DiagnosticSeverity.Warning:
      return 'warning'
    case DiagnosticSeverity.Information:
      return 'info'
    case DiagnosticSeverity.Hint:
      return 'hint'
    default:
      return 'info'
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
  private pendingDiagnostics = new Map<
    string,
    {
      resolve: (diagnostics: Diagnostic[]) => void
      timeout: NodeJS.Timeout
    }
  >()

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
      // Spawn the language server process using resolved command path.
      // Windows .cmd/.bat shims cannot be spawned directly (Node rejects them
      // without a shell). With a shell, pass a single pre-quoted command line:
      // args arrays alongside shell:true are deprecated (DEP0190), and quoting
      // keeps cmd.exe happy when the path contains spaces.
      const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(this.commandPath)
      const command = needsShell
        ? [`"${this.commandPath}"`, ...this.config.serverArgs].join(' ')
        : this.commandPath
      this.process = spawn(command, needsShell ? [] : this.config.serverArgs, {
        cwd: this.workdir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HOME: process.env['HOME'],
          PATH: process.env['PATH'],
        },
        windowsHide: true,
        shell: needsShell,
      })

      // Wait for the process to actually spawn before wiring JSON-RPC onto its
      // stdio. If spawn fails (e.g. ENOENT), sending initialize would leave an
      // in-flight write on a destroyed stdin, and vscode-jsonrpc's sendRequest
      // (async promise executor, connection.js) turns that write failure into
      // an unhandled rejection that crashes the whole OpenFox process.
      await new Promise<void>((resolve, reject) => {
        this.process!.once('spawn', resolve)
        this.process!.once('error', reject)
      })

      if (!this.process.stdin || !this.process.stdout) {
        throw new Error('Failed to get stdio streams from language server process')
      }

      // A dying server can still emit late stream errors (e.g. write after its
      // stdin got destroyed); without a listener those crash the process.
      const onStreamError = (err: Error) => {
        logger.debug('LSP stream error', { language: this.config.id, error: err.message })
      }
      this.process.stdin.on('error', onStreamError)
      this.process.stdout.on('error', onStreamError)

      // Set up JSON-RPC connection
      this.connection = createMessageConnection(
        new StreamMessageReader(this.process.stdout),
        new StreamMessageWriter(this.process.stdin),
      )

      // Handle diagnostics
      this.connection.onNotification(LSP.publishDiagnostics, (params: PublishDiagnosticsParams) => {
        this.handleDiagnostics(params)
      })

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
        workspaceFolders: [{ uri: `file://${this.workdir}`, name: 'workspace' }],
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

      logger.debug('LSP server started', {
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

    logger.debug('LSP server stopped', { language: this.config.id })
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
    const diagnostics: Diagnostic[] = params.diagnostics.map((d) => ({
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
  // Code Navigation Queries
  // ============================================================================

  /**
   * Convert a file:// URI to a local path.
   * Handles Windows paths (file:///C:/...) and URL-encoded characters.
   */
  private uriToPath(uri: string): string {
    try {
      return fileURLToPath(uri)
    } catch {
      // Fallback: strip file:// prefix for malformed URIs
      return uri.replace(/^file:\/\//, '')
    }
  }

  /**
   * Convert a local path to a file:// URI.
   */
  private pathToUri(path: string): string {
    return `file://${path}`
  }

  /**
   * Convert an LSP location to our internal CodeLocation.
   */
  private toCodeLocation(loc: LspLocation): CodeLocation {
    return {
      path: this.uriToPath(loc.uri),
      line: loc.range.start.line,
      character: loc.range.start.character,
      endLine: loc.range.end.line,
      endCharacter: loc.range.end.character,
    }
  }

  /**
   * Ensure the server is running before making a query.
   */
  private requireConnection(): MessageConnection {
    if (this.state !== 'running' || !this.connection) {
      throw new Error('LSP server is not running')
    }
    return this.connection
  }

  /**
   * Normalize a single Location or Location[] response into CodeLocation[].
   */
  private normalizeLocations(response: unknown): CodeLocation[] {
    if (!response) return []
    if (Array.isArray(response)) {
      return response.map((loc) => this.toCodeLocation(loc as LspLocation))
    }
    return [this.toCodeLocation(response as LspLocation)]
  }

  /**
   * Find the definition of a symbol at the given position.
   * Sends textDocument/definition request.
   */
  async getDefinition(path: string, line: number, character: number): Promise<CodeLocation[]> {
    try {
      const conn = this.requireConnection()
      const uri = this.pathToUri(path)
      const result = await conn.sendRequest(LSP.definition, {
        textDocument: { uri },
        position: { line, character },
      })
      return this.normalizeLocations(result)
    } catch {
      return []
    }
  }

  /**
   * Find all references to a symbol at the given position.
   * Sends textDocument/references request.
   */
  async getReferences(path: string, line: number, character: number): Promise<CodeLocation[]> {
    try {
      const conn = this.requireConnection()
      const uri = this.pathToUri(path)
      const result = await conn.sendRequest(LSP.references, {
        textDocument: { uri },
        position: { line, character },
        context: { includeDeclaration: true },
      })
      return this.normalizeLocations(result)
    } catch {
      return []
    }
  }

  /**
   * Find the type definition of a symbol at the given position.
   * Sends textDocument/typeDefinition request.
   */
  async getTypeDefinition(path: string, line: number, character: number): Promise<CodeLocation[]> {
    try {
      const conn = this.requireConnection()
      const uri = this.pathToUri(path)
      const result = await conn.sendRequest(LSP.typeDefinition, {
        textDocument: { uri },
        position: { line, character },
      })
      return this.normalizeLocations(result)
    } catch {
      return []
    }
  }

  /**
   * Search workspace for a symbol by name.
   * Sends workspace/symbol request.
   */
  async findWorkspaceSymbol(query: string): Promise<SymbolInfo[]> {
    try {
      const conn = this.requireConnection()
      const result = await conn.sendRequest(LSP.workspaceSymbol, { query })
      if (!Array.isArray(result)) return []
      return (result as LspSymbolInfo[]).map((sym): SymbolInfo => {
        const info: SymbolInfo = {
          name: sym.name,
          kind: this.symbolKindToString(sym.kind),
          location: this.toCodeLocation(sym.location),
        }
        if (sym.containerName) {
          info.containerName = sym.containerName
        }
        return info
      })
    } catch {
      return []
    }
  }

  /**
   * Get hover information for a symbol at the given position.
   * Sends textDocument/hover request.
   */
  async getHoverInfo(path: string, line: number, character: number): Promise<HoverInfo | null> {
    try {
      const conn = this.requireConnection()
      const uri = this.pathToUri(path)
      const result = (await conn.sendRequest(LSP.hover, {
        textDocument: { uri },
        position: { line, character },
      })) as LspHover | null

      if (!result) return null

      const contents = this.extractHoverContents(result.contents)
      const range = result.range
        ? {
            start: { line: result.range.start.line, character: result.range.start.character },
            end: { line: result.range.end.line, character: result.range.end.character },
          }
        : undefined
      return hoverInfo(contents, range)
    } catch {
      return null
    }
  }

  /**
   * Extract a plain-text string from hover contents (which can be
   * MarkupContent, MarkedString, or an array of either).
   */
  private extractHoverContents(contents: LspHoverContents | LspHoverContents[] | string): string {
    if (typeof contents === 'string') return contents
    if (Array.isArray(contents)) {
      return contents.map((c) => (typeof c === 'string' ? c : c.value)).join('\n\n')
    }
    return contents.value
  }

  /**
   * Convert LSP SymbolKind number to a human-readable string.
   * See https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolKind
   */
  private symbolKindToString(kind: number): string {
    return SYMBOL_KIND_NAMES[kind] ?? 'Unknown'
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

  hasOpenDocuments(): boolean {
    return this.openDocuments.size > 0
  }

  getExtensions(): string[] {
    return this.config.extensions
  }
}
