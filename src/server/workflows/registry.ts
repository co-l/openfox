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
import type { WorkflowLaunchScope, WorkflowScope } from '../../shared/types.js'
import { logger } from '../utils/logger.js'
import { saveItemToDir, jsonSerializer, deleteItemFromDir } from '../shared/item-loader.js'

const __bundleDir = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_DIR = join(__bundleDir, 'defaults')
const DEFAULTS_DIR_ALT = join(__bundleDir, 'workflow-defaults')
const WORKFLOW_EXTENSION = '.workflow.json'

export const WORKFLOW_SCOPES: readonly WorkflowScope[] = ['builtin', 'user', 'project']

/** Validate a wire-provided scope value; anything unrecognized falls back to 'auto' (server precedence). */
export function normalizeWorkflowScope(value: unknown): WorkflowLaunchScope {
  return typeof value === 'string' &&
    (value === 'builtin' || value === 'user' || value === 'project' || value === 'auto')
    ? value
    : 'auto'
}

function getWorkflowsDir(configDir: string): string {
  return join(configDir, 'workflows')
}

function getProjectWorkflowsDir(projectDir: string): string {
  return join(projectDir, '.openfox', 'workflows')
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

export async function loadProjectWorkflows(projectDir: string): Promise<WorkflowDefinition[]> {
  return loadWorkflowsFromDir(getProjectWorkflowsDir(projectDir))
}

export async function loadAllWorkflows(configDir: string, projectDir?: string): Promise<WorkflowDefinition[]> {
  const [defaultWorkflows, userWorkflows] = await Promise.all([loadDefaultWorkflows(), loadUserWorkflows(configDir)])

  const workflowMap = new Map<string, WorkflowDefinition>()
  for (const workflow of defaultWorkflows) {
    workflowMap.set(workflow.metadata.id, workflow)
  }
  for (const workflow of userWorkflows) {
    workflowMap.set(workflow.metadata.id, workflow)
  }

  if (projectDir) {
    const projectWorkflows = await loadProjectWorkflows(projectDir)
    for (const workflow of projectWorkflows) {
      workflowMap.set(workflow.metadata.id, workflow)
    }
  }

  return Array.from(workflowMap.values())
}

export interface WorkflowCatalogEntry {
  id: string
  name: string
  description?: string
  color?: string
  scope: WorkflowScope
  parameters?: import('../../shared/types.js').WorkflowParameter[]
}

/**
 * List the effective workflow catalog for a project: builtin + user + project,
 * deduplicated by id with project > user > builtin precedence, each entry
 * tagged with the scope that supplied it.
 */
export async function listAvailableWorkflows(configDir: string, projectDir?: string): Promise<WorkflowCatalogEntry[]> {
  const [defaultWorkflows, userWorkflows, projectWorkflows] = await Promise.all([
    loadDefaultWorkflows(),
    loadUserWorkflows(configDir),
    projectDir ? loadProjectWorkflows(projectDir) : Promise.resolve([] as WorkflowDefinition[]),
  ])

  const projectIds = new Set(projectWorkflows.map((w) => w.metadata.id))
  const userIds = new Set(userWorkflows.map((w) => w.metadata.id))
  const effective = [...defaultWorkflows, ...userWorkflows, ...projectWorkflows]
  const byId = new Map(effective.map((w) => [w.metadata.id, w]))

  return Array.from(byId.values()).map((workflow) => ({
    id: workflow.metadata.id,
    name: workflow.metadata.name,
    description: workflow.metadata.description,
    ...(workflow.metadata.color ? { color: workflow.metadata.color } : {}),
    scope: projectIds.has(workflow.metadata.id)
      ? ('project' as const)
      : userIds.has(workflow.metadata.id)
        ? ('user' as const)
        : ('builtin' as const),
    ...(workflow.metadata.parameters ? { parameters: workflow.metadata.parameters } : {}),
  }))
}

export async function saveWorkflowToProject(projectDir: string, workflow: WorkflowDefinition): Promise<void> {
  await saveItemToDir(getProjectWorkflowsDir(projectDir), workflow, WORKFLOW_EXTENSION, jsonSerializer)
}

export async function deleteProjectWorkflow(
  projectDir: string,
  workflowId: string,
): Promise<{ success: boolean; reason?: string }> {
  return deleteItemFromDir(getProjectWorkflowsDir(projectDir), workflowId, WORKFLOW_EXTENSION)
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

export async function workflowExists(configDir: string, workflowId: string, projectDir?: string): Promise<boolean> {
  if (await pathExists(join(getWorkflowsDir(configDir), `${workflowId}${WORKFLOW_EXTENSION}`))) return true
  if (projectDir && (await pathExists(join(getProjectWorkflowsDir(projectDir), `${workflowId}${WORKFLOW_EXTENSION}`))))
    return true
  return false
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

export async function getOverrideWorkflowIds(configDir: string, projectDir?: string): Promise<string[]> {
  const [defaultIds, userWorkflows, projectWorkflows] = await Promise.all([
    getDefaultWorkflowIds(),
    loadUserWorkflows(configDir),
    projectDir ? loadProjectWorkflows(projectDir) : [],
  ])
  const userOverrides = userWorkflows.map((w) => w.metadata.id).filter((id) => defaultIds.includes(id))
  const projectOverrides = projectWorkflows.map((w) => w.metadata.id).filter((id) => defaultIds.includes(id))
  return [...userOverrides, ...projectOverrides]
}
