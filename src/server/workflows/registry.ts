/**
 * Workflow Registry
 *
 * Discovers, loads, and manages workflows from the workflows directory.
 * Workflows are stored as .workflow.json files (plain JSON, not markdown).
 */

import { readdir, readFile, writeFile, copyFile, mkdir, access, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { WorkflowDefinition } from './types.js'
import { logger } from '../utils/logger.js'

const __bundleDir = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_DIR = join(__bundleDir, 'defaults')
const DEFAULTS_DIR_ALT = join(__bundleDir, 'workflow-defaults')
const WORKFLOW_EXTENSION = '.workflow.json'

// ============================================================================
// Directory Helpers
// ============================================================================

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

// ============================================================================
// Default Workflows Installation
// ============================================================================

/**
 * Copy bundled default workflows to the config workflows directory if they don't already exist.
 */
export async function ensureDefaultWorkflows(configDir: string): Promise<void> {
  const workflowsDir = getWorkflowsDir(configDir)

  if (!await pathExists(workflowsDir)) {
    await mkdir(workflowsDir, { recursive: true })
  }

  // Find bundled defaults (try dev path first, then production path)
  let defaultFiles: string[]
  let sourceDir: string
  try {
    defaultFiles = (await readdir(DEFAULTS_DIR)).filter(f => f.endsWith(WORKFLOW_EXTENSION))
    sourceDir = DEFAULTS_DIR
  } catch {
    try {
      defaultFiles = (await readdir(DEFAULTS_DIR_ALT)).filter(f => f.endsWith(WORKFLOW_EXTENSION))
      sourceDir = DEFAULTS_DIR_ALT
    } catch {
      logger.warn('No bundled workflow defaults found', { dir: DEFAULTS_DIR })
      return
    }
  }

  for (const file of defaultFiles) {
    const targetPath = join(workflowsDir, file)
    try {
      await copyFile(join(sourceDir, file), targetPath)
    } catch (err) {
      logger.error('Failed to copy default workflow', { file, error: err instanceof Error ? err.message : String(err) })
    }
  }
}

// ============================================================================
// Workflow Loading
// ============================================================================

/**
 * Load all workflows from the workflows directory.
 */
export async function loadAllWorkflows(configDir: string): Promise<WorkflowDefinition[]> {
  const workflowsDir = getWorkflowsDir(configDir)

  if (!await pathExists(workflowsDir)) {
    return []
  }

  let files: string[]
  try {
    files = (await readdir(workflowsDir)).filter(f => f.endsWith(WORKFLOW_EXTENSION))
  } catch {
    return []
  }

  const workflows: WorkflowDefinition[] = []
  for (const file of files) {
    try {
      const raw = await readFile(join(workflowsDir, file), 'utf-8')
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

// ============================================================================
// Workflow Lookup
// ============================================================================

/**
 * Find a workflow by ID from a list of loaded workflows.
 */
export function findWorkflowById(workflowId: string, workflows: WorkflowDefinition[]): WorkflowDefinition | undefined {
  return workflows.find(p => p.metadata.id === workflowId)
}

// ============================================================================
// Workflow CRUD
// ============================================================================

/**
 * Check if a workflow file exists.
 */
export async function workflowExists(configDir: string, workflowId: string): Promise<boolean> {
  const filePath = join(getWorkflowsDir(configDir), `${workflowId}${WORKFLOW_EXTENSION}`)
  return pathExists(filePath)
}

/**
 * Save a workflow definition to disk.
 */
export async function saveWorkflow(configDir: string, workflow: WorkflowDefinition): Promise<void> {
  const workflowsDir = getWorkflowsDir(configDir)
  if (!await pathExists(workflowsDir)) {
    await mkdir(workflowsDir, { recursive: true })
  }
  const filePath = join(workflowsDir, `${workflow.metadata.id}${WORKFLOW_EXTENSION}`)
  await writeFile(filePath, JSON.stringify(workflow, null, 2) + '\n', 'utf-8')
}

/**
 * Delete a workflow from disk.
 */
export async function deleteWorkflow(configDir: string, workflowId: string): Promise<boolean> {
  const filePath = join(getWorkflowsDir(configDir), `${workflowId}${WORKFLOW_EXTENSION}`)
  try {
    await unlink(filePath)
    return true
  } catch {
    return false
  }
}
