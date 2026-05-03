/**
 * Workflow Registry
 *
 * Discovers, loads, and manages workflows from the workflows directory.
 * Workflows are stored as .workflow.json files (plain JSON, not markdown).
 * Defaults are loaded from bundled defaults/ and are never copied to user config.
 * User items override defaults by ID.
 */

import { readdir, readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { WorkflowDefinition } from './types.js'
import { logger } from '../utils/logger.js'

const __bundleDir = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_DIR = join(__bundleDir, 'defaults')
const DEFAULTS_DIR_ALT = join(__bundleDir, 'workflow-defaults')
const WORKFLOW_EXTENSION = '.workflow.json'

function getWorkflowsDir(configDir: string): string {
  return join(configDir, 'workflows')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function loadWorkflowsFromDir(dir: string): Promise<WorkflowDefinition[]> {
  if (!(await pathExists(dir))) {
    return []
  }

  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(WORKFLOW_EXTENSION))
  } catch {
    return []
  }

  const workflows: WorkflowDefinition[] = []
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), 'utf-8')
      const parsed = JSON.parse(raw) as WorkflowDefinition
      if (parsed.metadata?.id && parsed.steps?.length > 0) {
        workflows.push(parsed)
      } else {
        logger.warn('Skipping invalid workflow file', { file })
      }
    } catch (err) {
      logger.warn('Failed to parse workflow file', { file, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return workflows
}

export async function loadDefaultWorkflows(): Promise<WorkflowDefinition[]> {
  let defaults = await loadWorkflowsFromDir(DEFAULTS_DIR)
  if (!defaults.length) {
    defaults = await loadWorkflowsFromDir(DEFAULTS_DIR_ALT)
  }
  return defaults
}

export async function loadUserWorkflows(configDir: string): Promise<WorkflowDefinition[]> {
  return loadWorkflowsFromDir(getWorkflowsDir(configDir))
}

export async function loadAllWorkflows(configDir: string): Promise<WorkflowDefinition[]> {
  const [defaultWorkflows, userWorkflows] = await Promise.all([loadDefaultWorkflows(), loadUserWorkflows(configDir)])

  const workflowMap = new Map<string, WorkflowDefinition>()
  for (const workflow of defaultWorkflows) {
    workflowMap.set(workflow.metadata.id, workflow)
  }
  for (const workflow of userWorkflows) {
    workflowMap.set(workflow.metadata.id, workflow)
  }

  return Array.from(workflowMap.values())
}

export async function getDefaultWorkflowIds(): Promise<string[]> {
  for (const dir of [DEFAULTS_DIR, DEFAULTS_DIR_ALT]) {
    try {
      const files = (await readdir(dir)).filter((f) => f.endsWith(WORKFLOW_EXTENSION))
      return files.map((f) => f.replace(WORKFLOW_EXTENSION, ''))
    } catch {
      /* try next */
    }
  }
  return []
}

export async function getDefaultWorkflowContent(workflowId: string): Promise<WorkflowDefinition | null> {
  const defaults = await loadDefaultWorkflows()
  return defaults.find((w) => w.metadata.id === workflowId) ?? null
}

export async function isDefaultWorkflow(workflowId: string): Promise<boolean> {
  const defaultIds = await getDefaultWorkflowIds()
  return defaultIds.includes(workflowId)
}

export function findWorkflowById(workflowId: string, workflows: WorkflowDefinition[]): WorkflowDefinition | undefined {
  return workflows.find((p) => p.metadata.id === workflowId)
}

export async function workflowExists(configDir: string, workflowId: string): Promise<boolean> {
  const filePath = join(getWorkflowsDir(configDir), `${workflowId}${WORKFLOW_EXTENSION}`)
  return pathExists(filePath)
}

export async function saveWorkflow(configDir: string, workflow: WorkflowDefinition): Promise<void> {
  const workflowsDir = getWorkflowsDir(configDir)
  if (!(await pathExists(workflowsDir))) {
    await mkdir(workflowsDir, { recursive: true })
  }
  const filePath = join(workflowsDir, `${workflow.metadata.id}${WORKFLOW_EXTENSION}`)
  await writeFile(filePath, JSON.stringify(workflow, null, 2) + '\n', 'utf-8')
}

export async function deleteWorkflow(
  configDir: string,
  workflowId: string,
): Promise<{ success: boolean; reason?: string }> {
  const isDefault = await isDefaultWorkflow(workflowId)
  if (isDefault) {
    return { success: false, reason: 'Cannot delete built-in defaults' }
  }
  const filePath = join(getWorkflowsDir(configDir), `${workflowId}${WORKFLOW_EXTENSION}`)
  try {
    await unlink(filePath)
    return { success: true }
  } catch {
    return { success: false }
  }
}

export async function getOverrideWorkflowIds(configDir: string): Promise<string[]> {
  const [defaultIds, userWorkflows] = await Promise.all([getDefaultWorkflowIds(), loadUserWorkflows(configDir)])
  return userWorkflows.map((w) => w.metadata.id).filter((id) => defaultIds.includes(id))
}
