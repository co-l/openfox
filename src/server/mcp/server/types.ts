import type { MetadataEntry, Message, Project, WorkflowParameter } from '../../../shared/types.js'
import type { PendingPathConfirmationPayload, PendingQuestionPayload } from '../../../shared/protocol.js'
import type { WorkflowLaunchPayload } from '../../runner/launch.js'
import type { SessionManager } from '../../session/manager.js'

export interface WorkflowListItem {
  id: string
  name: string
  description?: string
  color?: string
  scope?: string
  parameters?: WorkflowParameter[]
}

export interface OpenFoxMcpToolDeps {
  sessionManager: SessionManager
  listProjects(): Project[]
  /** Create a project at the given directory (creates the dir + git init, then registers it). */
  createProject(name: string, workdir: string): Promise<Project>
  /** Delete a project and all its sessions. Returns whether a project was found and removed. */
  deleteProject(projectId: string): boolean
  /** Set the full entry list for a metadata key (criteria, todos, review_findings, ...). Same store as the agent's session_metadata tool. */
  setMetadataEntries(sessionId: string, key: string, entries: MetadataEntry[]): void
  listWorkflows(projectDir?: string): Promise<WorkflowListItem[]>
  /** Top-level (non-subagent) agent ids available for the workdir, for mode validation. */
  topLevelAgentIds(workdir: string): Promise<string[]>
  /** Start (or resume) a workflow execution. Fire-and-forget like the WS runner.launch path. */
  launchWorkflow(sessionId: string, payload: WorkflowLaunchPayload): void
  /** Full session stop: drain queue, abort execution, cancel pending interactions. */
  stopSession(sessionId: string): void
  /** Abort the active workflow run only (task/MCP-launched runs): a live run is aborted, a paused (waiting) user-step execution is cancelled. Returns what was stopped, or null when nothing is active. */
  stopWorkflow(sessionId: string): { aborted: 'running' | 'paused' } | null
  answerQuestion(callId: string, answer: string, skip?: boolean): boolean
  pendingQuestions(sessionId: string): PendingQuestionPayload[]
  confirmPath(callId: string, approved: boolean, alwaysAllow?: boolean): boolean
  pendingConfirmations(sessionId: string): PendingPathConfirmationPayload[]
  recentMessages(sessionId: string, limit: number): { messages: Message[]; hiddenCount: number }
}

export interface OpenFoxMcpToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  [key: string]: unknown
}

export interface OpenFoxMcpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<OpenFoxMcpToolResult>
}
