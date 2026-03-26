/**
 * Runner Orchestrator
 *
 * Loads the active workflow and delegates to the workflow executor
 * (state machine driven). All events are appended to EventStore.
 */

import type { OrchestratorOptions, OrchestratorResult } from './types.js'
import { logger } from '../utils/logger.js'
import { getRuntimeConfig } from '../runtime-config.js'
import { getGlobalConfigDir } from '../../cli/paths.js'
import { loadAllWorkflows, findWorkflowById } from '../workflows/registry.js'
import { executeWorkflow } from '../workflows/executor.js'

/**
 * Run the orchestrator loop until done, blocked, or aborted.
 *
 * Loads the workflow (per-session override or global active) and
 * delegates to the workflow executor state machine.
 */
export async function runOrchestrator(options: OrchestratorOptions): Promise<OrchestratorResult> {
  const runtimeConfig = getRuntimeConfig()
  const workflowId = options.workflowId ?? runtimeConfig.activeWorkflowId ?? 'default'
  const configDir = getGlobalConfigDir(runtimeConfig.mode ?? 'production')

  const workflows = await loadAllWorkflows(configDir)
  const workflow = findWorkflowById(workflowId, workflows)

  if (!workflow) {
    throw new Error(`Workflow "${workflowId}" not found`)
  }

  logger.debug('Using workflow executor', { sessionId: options.sessionId, workflow: workflow.metadata.id })
  return executeWorkflow(workflow, options)
}
