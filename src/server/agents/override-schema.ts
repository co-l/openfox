/**
 * Shared override schema.
 *
 * The `{ providerId, model, reasoningEffort? }` shape is reused by agent
 * overrides, step overrides, and team assignments. Centralizing it avoids a
 * circular import between model-overrides.ts and teams.ts (both consume it,
 * and model-overrides imports team getters from teams).
 */

import { z } from 'zod'

export const overrideSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  reasoningEffort: z.string().min(1).optional(),
})

export type AgentModelOverride = z.infer<typeof overrideSchema>
