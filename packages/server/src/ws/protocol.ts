import type {
  ClientMessage,
  ServerMessage,
  ProjectCreatePayload,
  ProjectLoadPayload,
  ProjectUpdatePayload,
  ProjectDeletePayload,
  SessionCreatePayload,
  SessionLoadPayload,
  PlanMessagePayload,
  PlanEditCriteriaPayload,
  AgentIntervenePayload,
  CriterionHumanVerifyPayload,
  ProjectStatePayload,
  ProjectListPayload,
  SessionStatePayload,
  SessionListPayload,
  ErrorPayload,
} from '@openfox/shared/protocol'
import { isClientMessage, createServerMessage } from '@openfox/shared/protocol'
import type { Project } from '@openfox/shared'

export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(data)
    if (isClientMessage(parsed)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export function serializeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message)
}

export function createErrorMessage(code: string, message: string, correlationId?: string): ServerMessage<ErrorPayload> {
  return createServerMessage('error', { code, message }, correlationId)
}

export function createSessionStateMessage(session: import('@openfox/shared').Session, correlationId?: string): ServerMessage<SessionStatePayload> {
  return createServerMessage('session.state', { session }, correlationId)
}

export function createSessionListMessage(sessions: import('@openfox/shared').SessionSummary[], correlationId?: string): ServerMessage<SessionListPayload> {
  return createServerMessage('session.list', { sessions }, correlationId)
}

export function createProjectStateMessage(project: Project, correlationId?: string): ServerMessage<ProjectStatePayload> {
  return createServerMessage('project.state', { project }, correlationId)
}

export function createProjectListMessage(projects: Project[], correlationId?: string): ServerMessage<ProjectListPayload> {
  return createServerMessage('project.list', { projects }, correlationId)
}

// Type guards for payloads

// Project payloads
export function isProjectCreatePayload(payload: unknown): payload is ProjectCreatePayload {
  return typeof payload === 'object' && payload !== null && 'name' in payload && 'workdir' in payload
}

export function isProjectLoadPayload(payload: unknown): payload is ProjectLoadPayload {
  return typeof payload === 'object' && payload !== null && 'projectId' in payload
}

export function isProjectUpdatePayload(payload: unknown): payload is ProjectUpdatePayload {
  return typeof payload === 'object' && payload !== null && 'projectId' in payload && 'name' in payload
}

export function isProjectDeletePayload(payload: unknown): payload is ProjectDeletePayload {
  return typeof payload === 'object' && payload !== null && 'projectId' in payload
}

// Session payloads
export function isSessionCreatePayload(payload: unknown): payload is SessionCreatePayload {
  return typeof payload === 'object' && payload !== null && 'projectId' in payload
}

export function isSessionLoadPayload(payload: unknown): payload is SessionLoadPayload {
  return typeof payload === 'object' && payload !== null && 'sessionId' in payload
}

export function isPlanMessagePayload(payload: unknown): payload is PlanMessagePayload {
  return typeof payload === 'object' && payload !== null && 'content' in payload
}

export function isPlanEditCriteriaPayload(payload: unknown): payload is PlanEditCriteriaPayload {
  return typeof payload === 'object' && payload !== null && 'criteria' in payload
}

export function isAgentIntervenePayload(payload: unknown): payload is AgentIntervenePayload {
  return typeof payload === 'object' && payload !== null && 'response' in payload
}

export function isCriterionHumanVerifyPayload(payload: unknown): payload is CriterionHumanVerifyPayload {
  return typeof payload === 'object' && payload !== null && 'criterionId' in payload && 'passed' in payload
}
