/**
 * Pipeline Registry
 *
 * Discovers, loads, and manages pipelines from the pipelines directory.
 * Pipelines are stored as .pipeline.json files (plain JSON, not markdown).
 */

import { readdir, readFile, writeFile, copyFile, mkdir, access, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PipelineDefinition } from './types.js'
import { logger } from '../utils/logger.js'

const __bundleDir = dirname(fileURLToPath(import.meta.url))
const DEFAULTS_DIR = join(__bundleDir, 'defaults')
const DEFAULTS_DIR_ALT = join(__bundleDir, 'pipeline-defaults')
const PIPELINE_EXTENSION = '.pipeline.json'

// ============================================================================
// Directory Helpers
// ============================================================================

function getPipelinesDir(configDir: string): string {
  return join(configDir, 'pipelines')
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
// Default Pipelines Installation
// ============================================================================

/**
 * Copy bundled default pipelines to the config pipelines directory if they don't already exist.
 */
export async function ensureDefaultPipelines(configDir: string): Promise<void> {
  const pipelinesDir = getPipelinesDir(configDir)

  if (!await pathExists(pipelinesDir)) {
    await mkdir(pipelinesDir, { recursive: true })
  }

  // Find bundled defaults (try dev path first, then production path)
  let defaultFiles: string[]
  let sourceDir: string
  try {
    defaultFiles = (await readdir(DEFAULTS_DIR)).filter(f => f.endsWith(PIPELINE_EXTENSION))
    sourceDir = DEFAULTS_DIR
  } catch {
    try {
      defaultFiles = (await readdir(DEFAULTS_DIR_ALT)).filter(f => f.endsWith(PIPELINE_EXTENSION))
      sourceDir = DEFAULTS_DIR_ALT
    } catch {
      logger.warn('No bundled pipeline defaults found', { dir: DEFAULTS_DIR })
      return
    }
  }

  for (const file of defaultFiles) {
    const targetPath = join(pipelinesDir, file)
    if (!await pathExists(targetPath)) {
      try {
        await copyFile(join(sourceDir, file), targetPath)
        logger.info('Installed default pipeline', { file })
      } catch (err) {
        logger.error('Failed to copy default pipeline', { file, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }
}

// ============================================================================
// Pipeline Loading
// ============================================================================

/**
 * Load all pipelines from the pipelines directory.
 */
export async function loadAllPipelines(configDir: string): Promise<PipelineDefinition[]> {
  const pipelinesDir = getPipelinesDir(configDir)

  if (!await pathExists(pipelinesDir)) {
    return []
  }

  let files: string[]
  try {
    files = (await readdir(pipelinesDir)).filter(f => f.endsWith(PIPELINE_EXTENSION))
  } catch {
    return []
  }

  const pipelines: PipelineDefinition[] = []
  for (const file of files) {
    try {
      const raw = await readFile(join(pipelinesDir, file), 'utf-8')
      const parsed = JSON.parse(raw) as PipelineDefinition
      if (parsed.metadata?.id && parsed.steps?.length > 0) {
        pipelines.push(parsed)
      } else {
        logger.warn('Skipping invalid pipeline file', { file })
      }
    } catch (err) {
      logger.warn('Failed to parse pipeline file', { file, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return pipelines
}

// ============================================================================
// Pipeline Lookup
// ============================================================================

/**
 * Find a pipeline by ID from a list of loaded pipelines.
 */
export function findPipelineById(pipelineId: string, pipelines: PipelineDefinition[]): PipelineDefinition | undefined {
  return pipelines.find(p => p.metadata.id === pipelineId)
}

// ============================================================================
// Pipeline CRUD
// ============================================================================

/**
 * Check if a pipeline file exists.
 */
export async function pipelineExists(configDir: string, pipelineId: string): Promise<boolean> {
  const filePath = join(getPipelinesDir(configDir), `${pipelineId}${PIPELINE_EXTENSION}`)
  return pathExists(filePath)
}

/**
 * Save a pipeline definition to disk.
 */
export async function savePipeline(configDir: string, pipeline: PipelineDefinition): Promise<void> {
  const pipelinesDir = getPipelinesDir(configDir)
  if (!await pathExists(pipelinesDir)) {
    await mkdir(pipelinesDir, { recursive: true })
  }
  const filePath = join(pipelinesDir, `${pipeline.metadata.id}${PIPELINE_EXTENSION}`)
  await writeFile(filePath, JSON.stringify(pipeline, null, 2) + '\n', 'utf-8')
}

/**
 * Delete a pipeline from disk.
 */
export async function deletePipeline(configDir: string, pipelineId: string): Promise<boolean> {
  const filePath = join(getPipelinesDir(configDir), `${pipelineId}${PIPELINE_EXTENSION}`)
  try {
    await unlink(filePath)
    return true
  } catch {
    return false
  }
}
