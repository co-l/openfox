/**
 * Step Model Override Routes
 *
 * Per-step model overrides keyed by `workflowId:stepId`, stored in DB settings.
 * Resolution precedence: step override > team assignment > agent override >
 * session. See `resolveLLMClientForStep` in `agents/model-overrides.ts`.
 *
 * Mounted under `/api/workflows`, exposing
 *   GET/PUT/DELETE /:workflowId/steps/:stepId/model
 */

import { Router } from 'express'
import { getStepModelOverride, setStepModelOverride } from '../agents/model-overrides.js'
import { readOverrideFields } from './override-route-helpers.js'

export function createStepModelOverrideRoutes(): Router {
  const router = Router()

  router.get('/:workflowId/steps/:stepId/model', (req, res) => {
    const override = getStepModelOverride(req.params.workflowId, req.params.stepId)
    res.json(override ?? { providerId: null, model: null, reasoningEffort: null })
  })

  router.put('/:workflowId/steps/:stepId/model', (req, res) => {
    const { providerId, model, reasoningEffort, error } = readOverrideFields(req.body)
    if (error) return res.status(400).json({ error })
    // An empty body (no providerId/model) clears the override.
    if (providerId && model) {
      setStepModelOverride(req.params.workflowId, req.params.stepId, {
        providerId,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      })
    } else if (!providerId && !model) {
      setStepModelOverride(req.params.workflowId, req.params.stepId, null)
    } else {
      return res.status(400).json({ error: 'Both providerId and model are required' })
    }
    res.json({ success: true })
  })

  router.delete('/:workflowId/steps/:stepId/model', (req, res) => {
    setStepModelOverride(req.params.workflowId, req.params.stepId, null)
    res.json({ success: true })
  })

  return router
}
