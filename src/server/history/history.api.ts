import type { Request, Response } from 'express'
import { join } from 'node:path'
import { loadIndex, type IndexEntry } from './history.index.js'
import { loadConfig } from './history.config.js'

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
    
    // Load config for max entries
    const config = await loadConfig(workdir)
    
    // Load index
    let entries = await loadIndex(snapshotDir)
    
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
    console.error('Error getting history:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * GET /api/history/:snapshotId
 * Get specific snapshot details
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
    
    // For now, just return the entry from index
    // In the future, we could load the full snapshot from disk
    const snapshotDir = join(workdir, '.openfox', 'history')
    const entries = await loadIndex(snapshotDir)
    
    const entry = entries.find(e => {
      // Match by timestamp or path
      return e.timestamp === snapshotId || (e.path && e.path.includes(snapshotId))
    })
    
    if (!entry) {
      res.status(404).json({ error: 'Snapshot not found' })
      return
    }
    
    res.json({ entry })
  } catch (error) {
    console.error('Error getting snapshot:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
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
