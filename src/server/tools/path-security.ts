import { realpath } from 'node:fs/promises'
import { resolve, normalize, join, basename, sep } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import type { ServerMessage } from '../../shared/protocol.js'
import { createChatPathConfirmationMessage } from '../ws/protocol.js'
import { getEventStore } from '../events/index.js'

// ===========================================================================
// Constants
// ===========================================================================

/** Safe device paths that don't need confirmation */
const SAFE_PATHS = new Set([
  '/dev/null',
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/stdin',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/fd/0',
  '/dev/fd/1',
  '/dev/fd/2',
])

/** Directories that are always allowed (in addition to workdir) */
const ALLOWED_ROOTS = [
  '/tmp',
  '/var/tmp',
  tmpdir(),
]

/**
 * Patterns for files that may contain secrets and require confirmation
 * regardless of whether they're inside the workdir.
 * 
 * Note: .env.example is excluded as it typically contains placeholder values.
 */
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  // Dotenv files (but not .envrc, .env-example, .env.example)
  /^\.env$/,                              // .env
  /^\.env\.(?!example)[a-zA-Z0-9_.-]+$/,  // .env.local, .env.production (not .env.example)
  
  // Credential files
  /^credentials\.json$/i,
  /^secrets?\.(?:json|ya?ml|toml)$/i,
  
  // Private keys
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa/,
  /^id_ed25519/,
  /^id_ecdsa/,
  /^id_dsa/,
  
  // Auth configs
  /^\.netrc$/,
]

/**
 * Check if a path points to a sensitive file that may contain secrets.
 * Checks the basename of the path against known sensitive patterns.
 * 
 * @param path - The path to check (can be relative or absolute)
 * @returns true if the file matches a sensitive pattern
 */
export function isSensitivePath(path: string): boolean {
  const fileName = basename(path)
  if (!fileName) return false
  
  return SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(fileName))
}

// ===========================================================================
// Session Allowlist (paths approved by user)
// ===========================================================================

/** Per-session set of paths that user has approved for access */
const sessionAllowedPaths = new Map<string, Set<string>>()

/**
 * Add a path to the session's allowlist (user approved it)
 */
export function addAllowedPath(sessionId: string, path: string): void {
  if (!sessionAllowedPaths.has(sessionId)) {
    sessionAllowedPaths.set(sessionId, new Set())
  }
  sessionAllowedPaths.get(sessionId)!.add(normalize(path))
}

/**
 * Add multiple paths to the session's allowlist
 */
export function addAllowedPaths(sessionId: string, paths: string[]): void {
  for (const path of paths) {
    addAllowedPath(sessionId, path)
  }
}

/**
 * Check if a path is in the session's allowlist
 */
export function isPathAllowed(sessionId: string, path: string): boolean {
  const allowed = sessionAllowedPaths.get(sessionId)
  if (!allowed) return false
  return allowed.has(normalize(path))
}

/**
 * Clear the session's allowlist (e.g., on session delete)
 */
export function clearAllowedPaths(sessionId: string): void {
  sessionAllowedPaths.delete(sessionId)
}

// ===========================================================================
// Path Validation
// ===========================================================================

/**
 * Safely resolve a path, following symlinks if possible.
 * Falls back to normalize() if realpath fails (e.g., broken symlink, nonexistent).
 */
async function safeRealpath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    // For broken symlinks or nonexistent paths, resolve what we can
    // and treat the target as the path to check
    return normalize(resolve(path))
  }
}

/**
 * Check if a resolved path is within the sandbox (workdir or allowed roots).
 * Resolves symlinks to prevent escape via symlink chains.
 * Also checks the session's allowlist for user-approved paths.
 * 
 * @param path - The path to check (can be relative or absolute)
 * @param workdir - The session's working directory
 * @param sessionId - Optional session ID to check allowlist
 * @returns Object with `allowed` boolean and `resolvedPath` for error messages
 */
export async function isPathWithinSandbox(
  path: string,
  workdir: string,
  sessionId?: string
): Promise<{ allowed: boolean; resolvedPath: string }> {
  // Normalize and resolve both paths
  const normalizedWorkdir = normalize((await safeRealpath(workdir)).replace(/\/+$/, ''))
  
  // For the path, we need to handle the case where it might be a symlink
  // pointing outside the workdir
  let resolvedPath: string
  try {
    // Try to follow symlinks fully
    resolvedPath = normalize(await realpath(path))
  } catch {
    // If realpath fails (broken symlink, nonexistent), try to resolve what we can
    // For a broken symlink, we read where it points and check that
    try {
      const { readlink } = await import('node:fs/promises')
      const linkTarget = await readlink(path)
      // Resolve the link target relative to the link's directory
      const linkDir = resolve(path, '..')
      resolvedPath = normalize(resolve(linkDir, linkTarget))
    } catch {
      // Not a symlink or can't read - just normalize the path
      resolvedPath = normalize(resolve(path))
    }
  }

  // Remove trailing slashes for consistent comparison
  resolvedPath = resolvedPath.replace(/\/+$/, '')

  // Check if in workdir
  if (resolvedPath === normalizedWorkdir ||
      resolvedPath.startsWith(normalizedWorkdir + sep)) {
    return { allowed: true, resolvedPath }
  }

  // Check if in allowed roots (/tmp, /var/tmp)
  for (const root of ALLOWED_ROOTS) {
    const normalizedRoot = normalize(root)
    if (resolvedPath === normalizedRoot ||
        resolvedPath.startsWith(normalizedRoot + sep)) {
      return { allowed: true, resolvedPath }
    }
  }

  // Check if path was previously approved by user for this session
  if (sessionId && isPathAllowed(sessionId, resolvedPath)) {
    return { allowed: true, resolvedPath }
  }

  return { allowed: false, resolvedPath }
}

// ===========================================================================
// Command Path Extraction
// ===========================================================================

/**
 * Extract absolute paths from a shell command (heuristic).
 * Handles: /absolute/paths, ~/tilde/paths, quoted paths.
 * Filters out safe paths (/dev/*) and URLs.
 * 
 * @param command - The shell command to parse
 * @returns Array of absolute paths found (deduplicated)
 */
export function extractAbsolutePathsFromCommand(command: string): string[] {
  if (!command.trim()) {
    return []
  }

  const paths: string[] = []
  const home = homedir()

  // Remove URL schemes to avoid false positives
  // Replace http://, https://, ftp://, file:// with markers
  let sanitized = command
    .replace(/https?:\/\/[^\s'"]+/g, ' __URL__ ')
    .replace(/ftp:\/\/[^\s'"]+/g, ' __URL__ ')

  // Strip sed substitution patterns to avoid false positives from regex replacements
  // Handles: s/pattern/replacement/flags and s|pattern|replacement|flags etc.
  sanitized = sanitized.replace(/s\/[^\/]*\/[^\/]*\/[gip]*/g, ' __SED__ ')
  sanitized = sanitized.replace(/s\|[^|]*\|[^|]*\|[gip]*/g, ' __SED__ ')
  sanitized = sanitized.replace(/s:[^:]*:[^:]*:[gip]*/g, ' __SED__ ')

  // Handle file:// URLs specially - extract the path
  const fileUrlMatches = command.matchAll(/file:\/\/([^\s'"]+)/g)
  for (const match of fileUrlMatches) {
    const filePath = match[1]
    if (filePath && !isSafePath(filePath)) {
      paths.push(normalize(filePath))
    }
  }
  sanitized = sanitized.replace(/file:\/\/[^\s'"]+/g, ' __FILEURL__ ')

  // Pattern 1: Tilde paths ~/... or just ~
  // Match ~ followed by optional /path, at word boundary
  const tildePattern = /(?:^|[\s='"(])~(\/[^\s'"()]*)?(?=[\s'"()]|$)/g
  let match
  while ((match = tildePattern.exec(sanitized)) !== null) {
    const pathPart = match[1] ?? ''
    // Concatenate home + pathPart then resolve to handle ~/../etc properly
    // ~/../etc/passwd with home=/home/user becomes /home/user/../etc/passwd -> /etc/passwd
    const fullPath = home + pathPart
    const resolved = normalize(resolve(fullPath))
    if (!isSafePath(resolved)) {
      paths.push(resolved)
    }
  }

  // Pattern 2: Quoted strings (may contain paths with spaces)
  const quotedPattern = /["']([^"']+)["']/g
  while ((match = quotedPattern.exec(sanitized)) !== null) {
    const content = match[1]!
    
    // Check if it looks like a regex pattern (starts and ends with /)
    if (content.startsWith('/') && content.endsWith('/')) {
      continue // Skip regex patterns
    }
    
    // Check for absolute path
    if (content.startsWith('/')) {
      const resolved = normalize(content)
      if (!isSafePath(resolved)) {
        paths.push(resolved)
      }
    }
    // Check for tilde path
    else if (content.startsWith('~')) {
      const pathPart = content.slice(1) // Remove ~
      const fullPath = join(home, pathPart)
      const resolved = normalize(resolve(fullPath))
      if (!isSafePath(resolved)) {
        paths.push(resolved)
      }
    }
  }

  // Pattern 3: Unquoted absolute paths
  // Match / followed by path characters, at word boundary
  // Be careful not to match paths already in quotes or parts of URLs
  const absolutePattern = /(?:^|[\s=(])(\/?\/[a-zA-Z0-9_\-./]+)/g
  while ((match = absolutePattern.exec(sanitized)) !== null) {
    const pathCandidate = match[1]!
    
    // Skip if it's a URL marker
    if (pathCandidate.includes('__URL__') || pathCandidate.includes('__FILEURL__')) {
      continue
    }
    
    // Skip if it looks like a regex (surrounded by /)
    if (pathCandidate.endsWith('/') && pathCandidate.split('/').length <= 2) {
      continue
    }
    
    const resolved = normalize(pathCandidate)
    if (!isSafePath(resolved)) {
      paths.push(resolved)
    }
  }

  // Deduplicate
  return [...new Set(paths)]
}

/**
 * Extract sensitive file paths from a shell command.
 * Unlike extractAbsolutePathsFromCommand, this looks for relative paths
 * that match sensitive file patterns (like .env, credentials.json, etc.).
 * 
 * @param command - The shell command to parse
 * @returns Array of sensitive paths found (deduplicated)
 */
export function extractSensitivePathsFromCommand(command: string): string[] {
  if (!command.trim()) {
    return []
  }

  const paths: string[] = []

  // Pattern to match potential file paths (relative or in subdirectories)
  // Matches: .env, config/.env, "./file", 'file', paths with common extensions
  // Word boundaries are tricky in shell, so we look for common delimiters
  
  // Pattern 1: Quoted strings that might contain sensitive paths
  const quotedPattern = /["']([^"']+)["']/g
  let match
  while ((match = quotedPattern.exec(command)) !== null) {
    const content = match[1]!
    if (isSensitivePath(content)) {
      paths.push(content)
    }
  }

  // Pattern 2: Unquoted paths - look for tokens that could be file paths
  // Split by common shell delimiters and check each token
  // Remove quoted sections first to avoid double-matching
  const unquoted = command
    .replace(/["'][^"']*["']/g, ' ')  // Remove quoted strings
    .replace(/[|&;><]/g, ' ')          // Replace shell operators with spaces
  
  // Split by whitespace and check each token
  const tokens = unquoted.split(/\s+/).filter(Boolean)
  
  for (const token of tokens) {
    // Skip flags (start with -)
    if (token.startsWith('-')) continue
    
    // Skip URLs
    if (token.includes('://')) continue
    
    // Check if token is or contains a sensitive file
    if (isSensitivePath(token)) {
      paths.push(token)
    }
  }

  // Deduplicate
  return [...new Set(paths)]
}

/**
 * Check if a path is a "safe" device path that doesn't need confirmation
 */
function isSafePath(path: string): boolean {
  const normalized = normalize(path)
  return SAFE_PATHS.has(normalized)
}

// ===========================================================================
// Batch Path Checking
// ===========================================================================

export interface PathAccessResult {
  needsConfirmation: boolean
  deniedPaths: string[]      // Paths outside the sandbox
  sensitivePaths: string[]   // Paths matching sensitive file patterns (may overlap with deniedPaths)
}

/**
 * Check multiple paths and return which ones need confirmation
 * 
 * @param paths - Array of paths to check
 * @param workdir - The session's working directory
 * @param sessionId - Optional session ID to check allowlist
 * @returns Object with confirmation status and list of denied paths
 */
export async function checkPathsAccess(
  paths: string[],
  workdir: string,
  sessionId?: string
): Promise<PathAccessResult> {
  if (paths.length === 0) {
    return { needsConfirmation: false, deniedPaths: [], sensitivePaths: [] }
  }

  const deniedPaths: string[] = []
  const sensitivePaths: string[] = []

  for (const path of paths) {
    const result = await isPathWithinSandbox(path, workdir, sessionId)
    
    // Check if path is outside sandbox
    if (!result.allowed) {
      deniedPaths.push(result.resolvedPath)
    }
    
    // Check if path is sensitive (regardless of sandbox status)
    // But only if not already in session allowlist
    if (isSensitivePath(path) && !isPathAllowed(sessionId ?? '', path)) {
      // Use the resolved path for consistency
      sensitivePaths.push(result.resolvedPath)
    }
  }

  // Deduplicate
  const uniqueDenied = [...new Set(deniedPaths)]
  const uniqueSensitive = [...new Set(sensitivePaths)]

  return {
    needsConfirmation: uniqueDenied.length > 0 || uniqueSensitive.length > 0,
    deniedPaths: uniqueDenied,
    sensitivePaths: uniqueSensitive,
  }
}

// ===========================================================================
// Dangerous Command Detection
// ============================================================================

const DANGEROUS_PATTERNS = [
  /sudo\s/,
  /rm\s+(-rf?|--recursive)\s+[\/~]/,
  /chmod\s+777/,
  />\s*\/dev\/sd/,
  /mkfs\s/,
  /dd\s+if=/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
]

export function extractDangerousPatterns(command: string): string[] {
  const dangerous: string[] = []
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      dangerous.push(pattern.source)
    }
  }
  return dangerous
}

// ===========================================================================
// Request Path Access (Promise-based flow)
// ===========================================================================

const PathDenialReasonDangerous = 'dangerous_command' as const

/**
 * Request access to paths outside the sandbox or sensitive files.
 * If paths require confirmation, sends a confirmation event to the client and suspends
 * tool execution until the user responds.
 * 
 * @param paths - Array of paths to check
 * @param workdir - The session's working directory
 * @param sessionId - Session ID for allowlist tracking
 * @param callId - Unique ID for this confirmation request
 * @param tool - Name of the tool requesting access
 * @param onEvent - Callback to send events to the client
 * @param dangerLevel - When 'dangerous', bypass confirmation and auto-approve all paths
 * @param command - Optional command string to check for dangerous patterns
 * @throws PathAccessDeniedError if user denies access
 */
export async function requestPathAccess(
  paths: string[],
  workdir: string,
  sessionId: string,
  callId: string,
  tool: string,
  onEvent: (event: ServerMessage) => void,
  dangerLevel?: string,
  command?: string
): Promise<void> {
  // Helper to emit path.confirmation_pending event
  const emitPendingEvent = (confirmationPaths: string[], confirmationReason: 'outside_workdir' | 'sensitive_file' | 'both' | 'dangerous_command') => {
    try {
      const eventStore = getEventStore()
      eventStore.append(sessionId, {
        type: 'path.confirmation_pending',
        data: { callId, tool, paths: confirmationPaths, workdir, reason: confirmationReason },
      })
    } catch {
      // Event store might not be initialized in tests
    }
  }

  // Check for dangerous commands that need confirmation even without path access
  if (dangerLevel !== 'dangerous' && command) {
    const dangerousPatterns = extractDangerousPatterns(command)
    if (dangerousPatterns.length > 0) {
      emitPendingEvent([workdir], 'dangerous_command')
      const confirmationPromise = registerPathConfirmation(callId, [workdir], sessionId)
      onEvent(createChatPathConfirmationMessage(callId, tool, [dangerousPatterns.join(', ')], workdir, 'dangerous_command'))
      const approved = await confirmationPromise
      if (!approved) {
        throw new PathAccessDeniedError(dangerousPatterns, tool, 'dangerous_command')
      }
    }
  }

  // Check which paths need confirmation
  const result = await checkPathsAccess(paths, workdir, sessionId)
  
  if (!result.needsConfirmation) {
    // All paths allowed
    return
  }
  
  // Bypass confirmation in dangerous mode - auto-approve all paths
  if (dangerLevel === 'dangerous') {
    const allPaths = [...new Set([...result.deniedPaths, ...result.sensitivePaths])]
    addAllowedPaths(sessionId, allPaths)
    return
  }
  
  // Combine all paths that need confirmation (may overlap)
  const allPathsNeedingConfirmation = [...new Set([...result.deniedPaths, ...result.sensitivePaths])]
  
  // Determine reason based on which arrays have entries
  const hasDenied = result.deniedPaths.length > 0
  const hasSensitive = result.sensitivePaths.length > 0
  const reason = hasDenied && hasSensitive ? 'both' as const
    : hasDenied ? 'outside_workdir' as const
    : 'sensitive_file' as const
  
  // Emit pending event for persistence
  emitPendingEvent(allPathsNeedingConfirmation, reason)
  
  // Create the confirmation Promise and send event to client
  const confirmationPromise = registerPathConfirmation(callId, allPathsNeedingConfirmation, sessionId)
  
  // Send path confirmation event to client (this shows the modal)
  onEvent(createChatPathConfirmationMessage(callId, tool, allPathsNeedingConfirmation, workdir, reason))
  
  // Suspend tool execution until user responds
  const approved = await confirmationPromise
  
  if (!approved) {
    throw new PathAccessDeniedError(allPathsNeedingConfirmation, tool, reason)
  }
  
  // If approved, paths have already been added to allowlist by providePathConfirmation
}

// ===========================================================================
// Error Classes
// ===========================================================================

export type PathDenialReason = 'outside_workdir' | 'sensitive_file' | 'both' | 'dangerous_command'

/**
 * Error thrown when user denies path access.
 * This causes the agent run to abort.
 */
export class PathAccessDeniedError extends Error {
  constructor(
    public readonly paths: string[],
    public readonly tool: string,
    public readonly reason: PathDenialReason = 'outside_workdir'
  ) {
    const reasonText = reason === 'sensitive_file' 
      ? 'sensitive files (may contain secrets)'
      : reason === 'both'
      ? 'paths outside workdir and sensitive files'
      : 'paths outside workdir'
    super(`User denied access to ${reasonText}: ${paths.join(', ')}`)
    this.name = 'PathAccessDeniedError'
  }
}

/**
 * @deprecated Use requestPathAccess() instead which handles the Promise flow internally.
 * Kept for backward compatibility during transition.
 */
export class PathConfirmationInterrupt extends Error {
  constructor(
    public readonly callId: string,
    public readonly paths: string[],
    public readonly tool: string,
    public readonly workdir: string
  ) {
    super('Path confirmation required')
    this.name = 'PathConfirmationInterrupt'
  }
}

// ===========================================================================
// Confirmation State Management
// ===========================================================================

/** Pending path confirmations, keyed by callId */
const pendingConfirmations = new Map<string, {
  resolve: (approved: boolean) => void
  reject: (error: Error) => void
  paths: string[]
  sessionId: string
}>()

/**
 * Register a pending path confirmation.
 * Stores the paths and sessionId so they can be added to allowlist on approval.
 */
export function registerPathConfirmation(
  callId: string,
  paths: string[],
  sessionId: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    pendingConfirmations.set(callId, { resolve, reject, paths, sessionId })
  })
}

/**
 * Provide a response to a pending path confirmation.
 * Called by the WebSocket handler when user responds.
 * If approved, adds the paths to the session's allowlist.
 * If alwaysAllow is true, paths are added permanently to allowlist.
 * 
 * @param callId - The confirmation's unique ID
 * @param approved - Whether the user approved the access
 * @param alwaysAllow - If true, add paths to session allowlist permanently
 * @returns Object with found status, and if approved, the sessionId for re-triggering chat
 */
export function providePathConfirmation(
  callId: string,
  approved: boolean,
  alwaysAllow?: boolean
): {
  found: boolean
  sessionId?: string
  approved?: boolean
} {
  const pending = pendingConfirmations.get(callId)
  if (!pending) {
    return { found: false }
  }

  // Emit path.confirmation_responded event for persistence
  try {
    const eventStore = getEventStore()
    eventStore.append(pending.sessionId, {
      type: 'path.confirmation_responded',
      data: { callId, approved, alwaysAllow: alwaysAllow ?? false },
    })
  } catch (error) {
    // Event store might not be initialized in tests, continue without event
  }

  if (approved) {
    // Add paths to session's allowlist (always if approved, or only if alwaysAllow)
    if (alwaysAllow) {
      addAllowedPaths(pending.sessionId, pending.paths)
    } else {
      // For single approval, still add to allowlist for this session
      addAllowedPaths(pending.sessionId, pending.paths)
    }
  }

  pending.resolve(approved)
  pendingConfirmations.delete(callId)
  
  return { found: true, sessionId: pending.sessionId, approved }
}

/**
 * Cancel a pending path confirmation (e.g., on session abort).
 * 
 * @param callId - The confirmation's unique ID
 * @param reason - Reason for cancellation
 * @returns true if confirmation was found and cancelled, false otherwise
 */
export function cancelPathConfirmation(callId: string, reason: string): boolean {
  const pending = pendingConfirmations.get(callId)
  if (!pending) {
    return false
  }

  pending.reject(new Error(reason))
  pendingConfirmations.delete(callId)
  return true
}

export function cancelPathConfirmationsForSession(sessionId: string, reason: string): number {
  let cancelledCount = 0

  for (const [callId, pending] of pendingConfirmations.entries()) {
    if (pending.sessionId !== sessionId) {
      continue
    }

    pending.reject(new Error(reason))
    pendingConfirmations.delete(callId)
    cancelledCount += 1
  }

  return cancelledCount
}

/**
 * Check if there's a pending path confirmation.
 * 
 * @param callId - The confirmation's unique ID
 * @returns true if confirmation is pending
 */
export function hasPendingPathConfirmation(callId: string): boolean {
  return pendingConfirmations.has(callId)
}
