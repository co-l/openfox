/**
 * Session Export / Import
 *
 * Export a session as a self-contained JSON document that preserves the exact
 * cached layout (system prompt, tools, hash, prompt hash), the current
 * context-window messages and the full event history, so it can be imported in
 * another environment without breaking the provider-side prefix cache. On
 * import, any drift between the original environment's cached layout and the
 * target environment is announced via <system-reminder> messages, and an
 * import marker reminder is appended last.
 */

import { z } from 'zod'
import type { Message, Criterion, Todo, MetadataEntry } from '../../shared/types.js'
import type { LLMToolDefinition } from '../llm/types.js'
import type { StoredEvent } from '../events/types.js'
import { getProject } from '../db/projects.js'
import { getSessionState, getEventStore } from '../events/index.js'
import { VERSION } from '../../constants.js'
import type { SessionManager } from './manager.js'

export const SESSION_EXPORT_FORMAT = 'openfox-session'
export const SESSION_EXPORT_VERSION = 1

export const IMPORTED_SESSION_REMINDER =
  'This session was imported from another environment. The latest system reminders are authoritative.'

export interface SessionExportSource {
  openfoxVersion: string
  projectName: string
  workdir: string
  mode: string
  providerId: string | null
  providerModel: string | null
  effectiveModel: string
  /** Backend + base URL of the source provider, so an importer can match the
   *  same inference server even when the target names the provider differently. */
  providerBackend?: string
  providerUrl?: string
}

export interface SessionExportPayload {
  format: typeof SESSION_EXPORT_FORMAT
  version: number
  exportedAt: number
  source: SessionExportSource
  session: {
    title?: string
    providerId?: string | null
    providerModel?: string | null
    mode: string
    phase: string
    createdAt: string
    updatedAt: string
    criteria: Criterion[]
    todos: Todo[]
    metadataEntries: Record<string, MetadataEntry[]>
  }
  cachedLayout?: {
    systemPrompt: string
    tools: LLMToolDefinition[]
    hash: string
    promptHash?: string
  }
  messages: Message[]
  events: StoredEvent[]
}

const cachedLayoutSchema = z.object({
  systemPrompt: z.string(),
  tools: z.array(
    z.object({
      type: z.literal('function'),
      function: z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.record(z.string(), z.unknown()),
      }),
    }),
  ),
  hash: z.string(),
  promptHash: z.string().optional(),
})

const sessionExportSchema = z.object({
  format: z.literal(SESSION_EXPORT_FORMAT),
  version: z.number().int(),
  exportedAt: z.number(),
  source: z.object({
    openfoxVersion: z.string(),
    projectName: z.string(),
    workdir: z.string(),
    mode: z.string(),
    providerId: z.string().nullable(),
    providerModel: z.string().nullable(),
    effectiveModel: z.string(),
    providerBackend: z.string().optional(),
    providerUrl: z.string().optional(),
  }),
  session: z.object({
    title: z.string().optional(),
    providerId: z.string().nullable().optional(),
    providerModel: z.string().nullable().optional(),
    mode: z.string(),
    phase: z.string(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    criteria: z.array(z.record(z.string(), z.unknown())).optional(),
    todos: z.array(z.record(z.string(), z.unknown())).optional(),
    metadataEntries: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).optional(),
  }),
  cachedLayout: cachedLayoutSchema.optional(),
  messages: z.array(z.record(z.string(), z.unknown())).optional(),
  events: z.array(
    z.object({
      seq: z.number().int().positive(),
      timestamp: z.number(),
      sessionId: z.string(),
      type: z.string(),
      data: z.unknown(),
    }),
  ),
})

export type ParsedSessionExport = z.infer<typeof sessionExportSchema>

/**
 * Parse and validate an export payload (runtime validation of external input).
 * Throws a ZodError when the payload is not a valid session export.
 */
export function parseSessionExport(payload: unknown): ParsedSessionExport {
  return sessionExportSchema.parse(payload)
}

/**
 * Build the export document for a session: source environment info, session
 * metadata (including criteria/todos/metadata entries), the exact cached
 * layout (frozen prefix — never recomputed), the current context-window
 * messages and all non-tombstoned events in sequence order (original
 * seq/timestamp kept). Throws if the session does not exist.
 */
export function buildSessionExport(sessionManager: SessionManager, sessionId: string): SessionExportPayload {
  const session = sessionManager.requireSession(sessionId)
  const project = getProject(session.projectId)
  const state = getSessionState(sessionId)
  const cached = sessionManager.getCachedPrompt(sessionId)
  const effective = sessionManager.resolveEffectiveProviderModel(sessionId)
  const sourceProvider = session.providerId
    ? sessionManager
        .getProviderManager()
        .getProviders()
        .find((p) => p.id === session.providerId)
    : undefined

  return {
    format: SESSION_EXPORT_FORMAT,
    version: SESSION_EXPORT_VERSION,
    exportedAt: Date.now(),
    source: {
      openfoxVersion: VERSION,
      projectName: project?.name ?? 'unknown',
      workdir: session.workdir,
      mode: session.mode,
      providerId: session.providerId ?? null,
      providerModel: session.providerModel ?? null,
      effectiveModel: effective.model ?? '',
      ...(sourceProvider?.backend ? { providerBackend: sourceProvider.backend } : {}),
      ...(sourceProvider?.url ? { providerUrl: sourceProvider.url } : {}),
    },
    session: {
      ...(session.metadata.title ? { title: session.metadata.title } : {}),
      ...(session.providerId ? { providerId: session.providerId } : {}),
      ...(session.providerModel ? { providerModel: session.providerModel } : {}),
      mode: session.mode,
      phase: session.phase,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      criteria: state?.criteria ?? [],
      todos: state?.todos ?? [],
      metadataEntries: state?.metadataEntries ?? {},
    },
    ...(cached
      ? {
          cachedLayout: {
            systemPrompt: cached.systemPrompt,
            tools: cached.tools,
            hash: cached.hash,
            ...(cached.promptHash ? { promptHash: cached.promptHash } : {}),
          },
        }
      : {}),
    messages: sessionManager.getCurrentWindowMessages(sessionId),
    events: getEventStore().getEvents(sessionId),
  }
}
