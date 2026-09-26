/**
 * Derive the display status of a tool call from its result.
 *
 * Semantics:
 * - no result yet          -> 'pending'
 * - success                -> 'success'
 * - interrupted by user    -> 'interrupted'
 * - anything else          -> 'error'
 *
 * "Interrupted" is detected primarily from `metadata.interrupted`, which the
 * server sets when a run is aborted (single source of truth — the client must
 * not re-derive it from output heuristics). An anchored tail regex on the
 * abort marker is kept only as a fallback for events persisted before that
 * flag existed. It must NOT be detected from content that merely mentions the
 * marker text — e.g. read_file of a file that contains the literal string
 * (shell.ts does) is a successful read, not an interrupt.
 */
import type { ToolResult } from '@shared/types.js'

export type ToolStatus = 'pending' | 'success' | 'error' | 'interrupted'

// Legacy fallback for events persisted before the server started setting
// metadata.interrupted: a real interrupted run ends with the marker, followed
// only by the exit-code line (always 130 / SIGINT) and the duration line. A
// failed run that merely prints the marker mid-output exits with a real code
// (1, 127, …) and is not an interrupt.
const INTERRUPTED_TAIL = /\[interrupted by user\](?:\s*\[Exit code: 130\])?(?:\s*\[Duration: [^\]]+\])?\s*$/

export function deriveToolCallStatus(result: ToolResult | undefined): ToolStatus {
  if (!result) return 'pending'

  if (!result.success) {
    // The server sets metadata.interrupted on abort — single source of truth.
    if (result.metadata?.['interrupted'] === true) return 'interrupted'
    if (INTERRUPTED_TAIL.test((result.output ?? '').trimEnd())) return 'interrupted'
  }

  return result.success ? 'success' : 'error'
}
