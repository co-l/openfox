import { realpath } from 'node:fs/promises'
import { resolve, normalize, join, basename, sep, posix, win32 } from 'node:path'
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
const ALLOWED_ROOTS = ['/tmp', '/var/tmp', tmpdir()]

/**
 * Patterns for files that may contain secrets and require confirmation
 * regardless of whether they're inside the workdir.
 *
 * Note: .env.example is excluded as it typically contains placeholder values.
 */
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  // Dotenv files (but not .envrc, .env-example, .env.example)
  /^\.env$/, // .env
  /^\.env\.(?!example)[a-zA-Z0-9_.-]+$/, // .env.local, .env.production (not .env.example)

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

  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(fileName))
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
  const absolutePath = normalize(resolve(path))

  try {
    return await realpath(absolutePath)
  } catch {
    // For nonexistent paths, canonicalize the nearest existing ancestor so
    // platform aliases such as macOS /tmp -> /private/tmp stay comparable.
    const missingSegments: string[] = []
    let current = absolutePath

    while (true) {
      try {
        const canonicalParent = await realpath(current)
        return normalize(join(canonicalParent, ...missingSegments.reverse()))
      } catch {
        const parent = resolve(current, '..')
        if (parent === current) return absolutePath
        missingSegments.push(basename(current))
        current = parent
      }
    }
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
  sessionId?: string,
): Promise<{ allowed: boolean; resolvedPath: string }> {
  // Normalize and resolve both paths
  const normalizedWorkdir = normalize((await safeRealpath(workdir)).replace(/\/+$/, ''))

  // For the path, we need to handle the case where it might be a symlink
  // pointing outside the workdir
  let resolvedPath: string
  try {
    // Try to follow symlinks fully.
    resolvedPath = normalize(await realpath(path))
  } catch {
    // For a broken symlink, resolve its target; otherwise canonicalize the
    // nearest existing ancestor and append the missing path segments.
    try {
      const { readlink } = await import('node:fs/promises')
      const linkTarget = await readlink(path)
      const linkDir = resolve(path, '..')
      resolvedPath = await safeRealpath(resolve(linkDir, linkTarget))
    } catch {
      resolvedPath = await safeRealpath(path)
    }
  }

  // Remove trailing slashes for consistent comparison
  resolvedPath = resolvedPath.replace(/\/+$/, '')

  // Check if in workdir
  if (resolvedPath === normalizedWorkdir || resolvedPath.startsWith(normalizedWorkdir + sep)) {
    return { allowed: true, resolvedPath }
  }

  // Check if in allowed roots. Canonicalize roots too because macOS maps
  // paths such as /tmp and /etc through /private symlinks.
  for (const root of ALLOWED_ROOTS) {
    const normalizedRoot = normalize((await safeRealpath(root)).replace(/\/+$/, ''))
    if (resolvedPath === normalizedRoot || resolvedPath.startsWith(normalizedRoot + sep)) {
      return { allowed: true, resolvedPath }
    }
  }

  // Check if path was previously approved by user for this session
  if (sessionId && (isPathAllowed(sessionId, path) || isPathAllowed(sessionId, resolvedPath))) {
    return { allowed: true, resolvedPath }
  }

  return { allowed: false, resolvedPath }
}

// ===========================================================================
// Command Path Extraction
// ===========================================================================

/**
 * Check if a string looks like a regex pattern rather than a file path.
 * Uses characters that are diagnostic of regex patterns while avoiding
 * characters that commonly appear in legitimate filenames.
 *
 * Included: * ? + [ ] \  — core regex quantifiers, char classes, escaping
 * Excluded: ( ) { } | ^ $ — can appear in real filenames (e.g.,
 *   `file(1).txt`, `{braces}`, `pipe|sym`, `^caret`, `$variable`)
 */
function looksLikeRegex(str: string): boolean {
  return /[*?+[\]\\]/.test(str)
}

/** Evaluated at call time so tests can stub process.platform. */
const isWindows = () => process.platform === 'win32'

/**
 * Check if a string is a Windows drive-letter absolute path (C:\... or C:/...).
 */
function isWindowsAbsolutePath(str: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(str)
}

/**
 * Normalize an extracted path according to its own shape, not the host
 * platform: host normalize() would turn "/var/log" into "\var\log" on
 * Windows, breaking comparisons and the SAFE_PATHS lookup.
 */
function normalizeExtracted(path: string): string {
  return isWindowsAbsolutePath(path) ? win32.normalize(path) : posix.normalize(path)
}

/**
 * Check if a string is a placeholder marker left by sanitization.
 * These are not real paths and should be skipped.
 */
function isPlaceholderToken(str: string): boolean {
  return (
    str.includes('__URL__') || str.includes('__FILEURL__') || str.includes('__SED__') || str.includes('__COMMIT_MSG__')
  )
}

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
  let sanitized = command.replace(/https?:\/\/[^\s'"]+/g, ' __URL__ ').replace(/ftp:\/\/[^\s'"]+/g, ' __URL__ ')

  // Strip sed substitution patterns to avoid false positives from regex replacements
  // Handles: s/pattern/replacement/flags and s|pattern|replacement|flags etc.
  sanitized = sanitized.replace(/(?<!\w)s\/[^/]*\/[^/]*\/[gip]*/g, ' __SED__ ')
  sanitized = sanitized.replace(/(?<!\w)s\|[^|]*\|[^|]*\|[gip]*/g, ' __SED__ ')
  sanitized = sanitized.replace(/(?<!\w)s:[^:]*:[^:]*:[gip]*/g, ' __SED__ ')

  // Strip git commit -m/--message content to avoid treating commit message
  // text as file paths (e.g. "/api/auto-update" in a commit message).
  // The message argument is a quoted string that should not be scanned for paths.
  sanitized = sanitized.replace(
    /git\s+commit\b.*?(?:-(?:[a-zA-Z]*m)(?=\s)|--message)\s+(["'])(?:(?!\1).)*\1/g,
    (match) => match.replace(/\/[^\s"'|&;<>`()]+/g, ' __COMMIT_MSG__ '),
  )

  // Handle file:// URLs specially - extract the path
  const fileUrlMatches = command.matchAll(/file:\/\/([^\s'"]+)/g)
  for (const match of fileUrlMatches) {
    const filePath = match[1]
    if (filePath && !isSafePath(filePath)) {
      paths.push(normalizeExtracted(filePath))
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

    // Check if it looks like a regex pattern with metacharacters
    if (content.startsWith('/') && looksLikeRegex(content)) {
      continue
    }

    // Check for absolute path
    if (isWindowsAbsolutePath(content)) {
      const resolved = normalizeExtracted(content)
      if (!isSafePath(resolved)) {
        paths.push(resolved)
      }
    } else if (!isWindows() && content.startsWith('/')) {
      const resolved = normalizeExtracted(content)
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
  // Strategy: boundary + broad character class + predicate pipeline.
  // Each predicate is a small, named function with a single responsibility.
  if (isWindows()) {
    // On Windows (cmd.exe), "/token" is a command switch (dir /s, findstr /i),
    // not a path. Only drive-letter paths (C:\... or C:/...) are absolute paths.
    // looksLikeRegex is skipped: backslashes are separators here, and the
    // drive-letter prefix is diagnostic enough.
    const winAbsolutePattern = /(?:^|[\s=(])([A-Za-z]:[\\/][^\s"'|&;<>`()]+)/g
    while ((match = winAbsolutePattern.exec(sanitized)) !== null) {
      const candidate = match[1]!
      if (isPlaceholderToken(candidate)) continue
      const resolved = normalizeExtracted(candidate)
      if (!isSafePath(resolved)) {
        paths.push(resolved)
      }
    }
  } else {
    const absolutePattern = /(?:^|[\s=(])(\/[^\s"'|&;<>`()]+)/g
    while ((match = absolutePattern.exec(sanitized)) !== null) {
      const candidate = match[1]!

      // Skip placeholder markers left by sanitization
      if (isPlaceholderToken(candidate)) continue

      // Skip if it looks like a regex pattern with metacharacters
      if (looksLikeRegex(candidate)) continue

      const resolved = normalizeExtracted(candidate)
      // Skip root or empty (e.g. "//" comment lines normalize to "/")
      if (resolved === '/' || resolved === '') continue
      if (!isSafePath(resolved)) {
        paths.push(resolved)
      }
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
    .replace(/["'][^"']*["']/g, ' ') // Remove quoted strings
    .replace(/[|&;><]/g, ' ') // Replace shell operators with spaces

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
  // SAFE_PATHS entries are Unix device paths — posix semantics regardless of host.
  const normalized = posix.normalize(path)
  return SAFE_PATHS.has(normalized)
}

// ===========================================================================
// Batch Path Checking
// ===========================================================================

export interface PathAccessResult {
  needsConfirmation: boolean
  deniedPaths: string[] // Paths outside the sandbox
  sensitivePaths: string[] // Paths matching sensitive file patterns (may overlap with deniedPaths)
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
  sessionId?: string,
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
  /rm\s+(-rf?|--recursive)\s+[~]/,
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

export function extractGitNoVerify(command: string): boolean {
  const subCommands = command.split(/\s*(?:&&|\|\||\||;)\s*/)
  for (const sub of subCommands) {
    const parts = sub.trim().split(/\s+/)
    const gitIndex = parts.indexOf('git')
    const subCmd = parts[gitIndex + 1]
    if (gitIndex >= 0 && subCmd && !subCmd.startsWith('-')) {
      const gitArgs = parts.slice(gitIndex + 2)
      if (gitArgs.some((a) => a === '--no-verify' || a === '-n')) {
        return true
      }
    }
  }
  return false
}

// ===========================================================================
// Request Path Access (Promise-based flow)
// ===========================================================================

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
  command?: string,
  isSubAgent?: boolean,
): Promise<void> {
  // Sub-agent shortcut: skip all confirmation dialogs since they don't render
  // properly in the small sub-agent window. Fail closed in normal mode;
  // auto-approve everything in dangerous mode.
  if (isSubAgent) {
    const result = await checkPathsAccess(paths, workdir, sessionId)
    if (!result.needsConfirmation) return

    if (dangerLevel === 'dangerous') {
      const allPaths = [...new Set([...result.deniedPaths, ...result.sensitivePaths])]
      addAllowedPaths(sessionId, allPaths)
      return
    }

    const allPaths = [...new Set([...result.deniedPaths, ...result.sensitivePaths])]
    const hasDenied = result.deniedPaths.length > 0
    const hasSensitive = result.sensitivePaths.length > 0
    const reason: PathDenialReason =
      hasDenied && hasSensitive ? 'both' : hasDenied ? 'outside_workdir' : 'sensitive_file'
    throw new PathAccessDeniedError(allPaths, tool, reason)
  }

  // Helper to emit path.confirmation_pending event
  const emitPendingEvent = (
    confirmationPaths: string[],
    confirmationReason: 'outside_workdir' | 'sensitive_file' | 'both' | 'dangerous_command' | 'git_no_verify',
  ) => {
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

  // Check for git --no-verify - ALWAYS requires confirmation, even in dangerous mode
  // This ensures the user is aware the agent is bypassing hooks/pre-commit checks
  if (command && extractGitNoVerify(command)) {
    emitPendingEvent([workdir], 'git_no_verify')
    const confirmationPromise = registerPathConfirmation(callId, [workdir], sessionId)
    onEvent(createChatPathConfirmationMessage(callId, tool, ['git --no-verify detected'], workdir, 'git_no_verify'))
    const approved = await confirmationPromise
    if (!approved) {
      throw new PathAccessDeniedError(
        ['git --no-verify'],
        tool,
        'git_no_verify',
        'User denied git command with --no-verify. The agent must not use --no-verify and must resolve the issue (e.g., fix lint errors, resolve conflicts) that prevents the commit.',
      )
    }
  }

  // Check for dangerous commands that need confirmation even without path access
  if (dangerLevel !== 'dangerous' && command) {
    const dangerousPatterns = extractDangerousPatterns(command)
    if (dangerousPatterns.length > 0) {
      emitPendingEvent([workdir], 'dangerous_command')
      const confirmationPromise = registerPathConfirmation(callId, [workdir], sessionId)
      onEvent(
        createChatPathConfirmationMessage(callId, tool, [dangerousPatterns.join(', ')], workdir, 'dangerous_command'),
      )
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
  const reason =
    hasDenied && hasSensitive
      ? ('both' as const)
      : hasDenied
        ? ('outside_workdir' as const)
        : ('sensitive_file' as const)

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

export type PathDenialReason = 'outside_workdir' | 'sensitive_file' | 'both' | 'dangerous_command' | 'git_no_verify'

/**
 * Error thrown when user denies path access.
 * This causes the agent run to abort.
 */
export class PathAccessDeniedError extends Error {
  constructor(
    public readonly paths: string[],
    public readonly tool: string,
    public readonly reason: PathDenialReason = 'outside_workdir',
    public readonly customMessage?: string,
  ) {
    const reasonText =
      reason === 'sensitive_file'
        ? 'sensitive files (may contain secrets)'
        : reason === 'both'
          ? 'paths outside workdir and sensitive files'
          : reason === 'git_no_verify'
            ? 'git commands with --no-verify'
            : 'paths outside workdir'
    super(customMessage ?? `User denied access to ${reasonText}: ${paths.join(', ')}`)
    this.name = 'PathAccessDeniedError'
  }
}

// ===========================================================================
// Confirmation State Management
// ===========================================================================

/** Pending path confirmations, keyed by callId */
const pendingConfirmations = new Map<
  string,
  {
    resolve: (approved: boolean) => void
    reject: (error: Error) => void
    paths: string[]
    sessionId: string
  }
>()

/**
 * Register a pending path confirmation.
 * Stores the paths and sessionId so they can be added to allowlist on approval.
 */
export function registerPathConfirmation(callId: string, paths: string[], sessionId: string): Promise<boolean> {
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
  alwaysAllow?: boolean,
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
  } catch {
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
