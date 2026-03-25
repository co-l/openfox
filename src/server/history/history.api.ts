import type { Request, Response } from 'express'
import { join } from 'node:path'
import { loadIndex, loadSnapshot, saveIndex, type IndexEntry } from './history.index.js'
import { loadConfig } from './history.config.js'
import { isPathExcluded, loadGitignore } from './history.utils.js'
import { logger } from '../utils/logger.js'

// ============================================================================
// Types
// ============================================================================

export interface HistoryListResponse {
  entries: Array<{
    path: string
    timestamp: string
    changeType: string
    hashBefore: string | null
    hashAfter: string | null
    snapshotPath?: string
  }>
  pagination: {
    page: number
    pageSize: number
    total: number
    hasMore: boolean
  }
}

export interface HistoryFilters {
  from?: string
  to?: string
  pathPattern?: string
  changeType?: string
}

// ============================================================================
// API Handlers
// ============================================================================

/**
 * GET /api/history
 * List history entries with pagination and filters
 */
export async function getHistory(req: Request, res: Response): Promise<void> {
  try {
    const workdir = req.query['workdir'] as string
    if (!workdir) {
      res.status(400).json({ error: 'workdir parameter required' })
      return
    }
    
    const snapshotDir = join(workdir, '.openfox', 'history')
    
    const config = await loadConfig(workdir)
    let entries = await loadVisibleEntries(workdir, snapshotDir, config.excludePatterns)
    
    // Apply filters
    const filters = getFiltersFromQuery(req.query)
    entries = filterEntries(entries, filters)
    
    // Pagination
    const page = parseInt(req.query['page'] as string) || 1
    const pageSize = parseInt(req.query['pageSize'] as string) || 50
    const total = entries.length
    const startIndex = (page - 1) * pageSize
    const endIndex = startIndex + pageSize
    const paginatedEntries = entries.slice(startIndex, endIndex)
    
    const response: HistoryListResponse = {
      entries: paginatedEntries,
      pagination: {
        page,
        pageSize,
        total,
        hasMore: endIndex < total,
      },
    }
    
    res.json(response)
  } catch (error) {
    logger.error('Error getting history', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET /api/history/:snapshotId
 * Get specific snapshot details with full content
 */
export async function getHistorySnapshot(req: Request, res: Response): Promise<void> {
  try {
    const workdir = req.query['workdir'] as string
    const snapshotId = typeof req.params['snapshotId'] === 'string' ? req.params['snapshotId'] : ''
    
    if (!workdir) {
      res.status(400).json({ error: 'workdir parameter required' })
      return
    }
    
    if (!snapshotId) {
      res.status(400).json({ error: 'snapshotId parameter required' })
      return
    }
    
    const snapshotDir = join(workdir, '.openfox', 'history')
    const config = await loadConfig(workdir)
    const entries = await loadVisibleEntries(workdir, snapshotDir, config.excludePatterns)
    
    // Find the entry by timestamp (snapshotId is the timestamp)
    const entry = entries.find(e => e.timestamp === snapshotId)
    
    if (!entry) {
      res.status(404).json({ error: 'Snapshot not found' })
      return
    }
    
    // Load the full snapshot from disk using the helper function
    const snapshotPath = await findSnapshotFile(snapshotDir, entry)
    
    let content: string | null = null
    
    if (snapshotPath) {
      const snapshotData = await loadSnapshot(snapshotPath)
      if (snapshotData && snapshotData.content) {
        content = Buffer.from(snapshotData.content, 'base64').toString('utf-8')
      }
    }
    
    res.json({
      entry: {
        ...entry,
        content,
      },
    })
  } catch (error) {
    logger.error('Error getting snapshot', { error: error instanceof Error ? error.message : String(error) })
    res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * Find the snapshot file for a given entry
 */
async function findSnapshotFile(snapshotDir: string, entry: IndexEntry): Promise<string | null> {
  const { existsSync, readdirSync } = await import('node:fs')
  
  const date = new Date(entry.timestamp)
  const year = date.getFullYear().toString()
  const month = (date.getMonth() + 1).toString().padStart(2, '0') // getMonth() is 0-indexed!
  const day = date.getDate().toString().padStart(2, '0')
  
  const dateDir = join(snapshotDir, year, month, day)
  
  if (!existsSync(dateDir)) {
    return null
  }
  
  // Search for the snapshot file
  const searchPattern = `${entry.path.replace(/[\\/]/g, '_')}_ts-`
  
  try {
    const files = readdirSync(dateDir)
    const matchingFile = files.find((f: string) => f.startsWith(searchPattern))
    
    if (matchingFile) {
      return join(dateDir, matchingFile)
    }
  } catch {
    // Directory might not be readable
  }
  
  return null
}

async function loadVisibleEntries(
  workdir: string,
  snapshotDir: string,
  excludePatterns: string[]
): Promise<IndexEntry[]> {
  const [entries, gitignorePatterns] = await Promise.all([
    loadIndex(snapshotDir),
    loadGitignore(workdir),
  ])

  const allPatterns = [...gitignorePatterns, ...excludePatterns]
  const visibleEntries = entries.filter(entry => !isPathExcluded(entry.path, allPatterns))

  if (visibleEntries.length !== entries.length) {
    await saveIndex(snapshotDir, visibleEntries)
  }

  return visibleEntries
}

// ============================================================================
// Helpers
// ============================================================================

function getFiltersFromQuery(query: Record<string, unknown>): HistoryFilters {
  const filters: HistoryFilters = {}
  
  if (typeof query['from'] === 'string') {
    filters.from = query['from']
  }
  
  if (typeof query['to'] === 'string') {
    filters.to = query['to']
  }
  
  if (typeof query['path'] === 'string') {
    filters.pathPattern = query['path']
  }
  
  if (typeof query['changeType'] === 'string') {
    filters.changeType = query['changeType']
  }
  
  return filters
}

function filterEntries(entries: IndexEntry[], filters: HistoryFilters): IndexEntry[] {
  return entries.filter(entry => {
    // Filter by date range
    if (filters.from) {
      const fromDate = new Date(filters.from)
      const entryDate = new Date(entry.timestamp)
      if (entryDate < fromDate) return false
    }
    
    if (filters.to) {
      const toDate = new Date(filters.to)
      const entryDate = new Date(entry.timestamp)
      if (entryDate > toDate) return false
    }
    
    // Filter by path pattern (simple contains match)
    if (filters.pathPattern) {
      if (!entry.path.includes(filters.pathPattern!)) return false
    }
    
    // Filter by change type
    if (filters.changeType) {
      if (entry.changeType !== filters.changeType) return false
    }
    
    return true
  })
}
