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

interface WorkflowBuckets {
  defaultWorkflows: WorkflowDefinition[]
  userWorkflows: WorkflowDefinition[]
  projectWorkflows: WorkflowDefinition[]
}

/**
 * Read the three workflow buckets once. Both the merged list and the resolved
 * scope are derived from these buckets, so the project > user > builtin
 * precedence lives in exactly one place.
 */
async function loadWorkflowBuckets(configDir: string, projectDir?: string): Promise<WorkflowBuckets> {
  const [defaultWorkflows, userWorkflows, projectWorkflows] = await Promise.all([
    loadDefaultWorkflows(),
    loadUserWorkflows(configDir),
    projectDir ? loadProjectWorkflows(projectDir) : Promise.resolve([] as WorkflowDefinition[]),
  ])
  return { defaultWorkflows, userWorkflows, projectWorkflows }
}

/**
 * Merge the buckets with project > user > builtin precedence and tag each id
 * with the scope that supplied it.
 */
function mergeWorkflowBuckets(buckets: WorkflowBuckets): {
  workflows: WorkflowDefinition[]
  scopes: Map<string, WorkflowScope>
} {
  const workflowMap = new Map<string, WorkflowDefinition>()
  const scopes = new Map<string, WorkflowScope>()
  for (const workflow of buckets.defaultWorkflows) {
    workflowMap.set(workflow.metadata.id, workflow)
    scopes.set(workflow.metadata.id, 'builtin')
  }
  for (const workflow of buckets.userWorkflows) {
    workflowMap.set(workflow.metadata.id, workflow)
    scopes.set(workflow.metadata.id, 'user')
  }
  for (const workflow of buckets.projectWorkflows) {
    workflowMap.set(workflow.metadata.id, workflow)
    scopes.set(workflow.metadata.id, 'project')
  }
  return { workflows: Array.from(workflowMap.values()), scopes }
}

/**
 * Load every effective workflow together with the scope that supplied each id.
 * Callers that need both the definition and its scope must use this instead of
 * calling `loadAllWorkflows` + `resolveWorkflowScope`, which would read the
 * buckets twice.
 */
export async function loadWorkflowsWithScope(
  configDir: string,
  projectDir?: string,
): Promise<{ workflows: WorkflowDefinition[]; scopes: Map<string, WorkflowScope> }> {
  return mergeWorkflowBuckets(await loadWorkflowBuckets(configDir, projectDir))
}

export async function loadAllWorkflows(configDir: string, projectDir?: string): Promise<WorkflowDefinition[]> {
  return (await loadWorkflowsWithScope(configDir, projectDir)).workflows
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
  const { workflows, scopes } = await loadWorkflowsWithScope(configDir, projectDir)

  return workflows.map((workflow) => ({
    id: workflow.metadata.id,
    name: workflow.metadata.name,
    description: workflow.metadata.description,
    ...(workflow.metadata.color ? { color: workflow.metadata.color } : {}),
    scope: scopes.get(workflow.metadata.id) ?? ('builtin' as const),
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

/**
 * Resolve a workflow id to the scope that actually supplies it, applying the
 * server precedence (project > user > builtin). The client uses it to load the
 * very definition that is running, even when another scope shadows the same
 * id.
 *
 * Callers that also need the definitions must use `loadWorkflowsWithScope`
 * instead of calling this next to `loadAllWorkflows`, so the buckets are read
 * once.
 */
export async function resolveWorkflowScope(
  workflowId: string,
  configDir: string,
  projectDir?: string,
): Promise<WorkflowScope> {
  const { scopes } = await loadWorkflowsWithScope(configDir, projectDir)
  return scopes.get(workflowId) ?? 'builtin'
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
