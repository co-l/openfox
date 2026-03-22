import { useState, useEffect } from 'react'
import { X, Calendar, FileText, Plus, Trash2, Edit2 } from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

interface HistoryEntry {
  path: string
  timestamp: string
  changeType: 'create' | 'modify' | 'delete'
  hashBefore: string | null
  hashAfter: string | null
}

interface HistoryResponse {
  entries: HistoryEntry[]
  pagination: {
    page: number
    pageSize: number
    total: number
    hasMore: boolean
  }
}

interface HistoryModalProps {
  isOpen: boolean
  onClose: () => void
  workdir: string
}

// ============================================================================
// Main Component
// ============================================================================

export function HistoryModal({ isOpen, onClose, workdir }: HistoryModalProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null)
  
  // Filters
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [pathFilter, setPathFilter] = useState('')
  const [changeTypeFilter, setChangeTypeFilter] = useState<string[]>([])

  useEffect(() => {
    if (isOpen) {
      loadHistory()
    }
  }, [isOpen, page])

  const loadHistory = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        workdir,
        page: page.toString(),
        pageSize: '50',
      })
      
      if (fromDate) params.append('from', fromDate)
      if (toDate) params.append('to', toDate)
      if (pathFilter) params.append('path', pathFilter)
      if (changeTypeFilter.length > 0) {
        changeTypeFilter.forEach(type => params.append('changeType', type))
      }
      
      const response = await fetch(`/api/history?${params}`)
      const data: HistoryResponse = await response.json()
      
      if (page === 1) {
        setEntries(data.entries)
      } else {
        setEntries(prev => [...prev, ...data.entries])
      }
      
      setHasMore(data.pagination.hasMore)
    } catch (error) {
      console.error('Error loading history:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleToggleChangeType = (type: string) => {
    setChangeTypeFilter(prev => 
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    )
  }

  const getChangeTypeIcon = (type: string) => {
    switch (type) {
      case 'create':
        return <Plus className="w-4 h-4 text-green-500" />
      case 'modify':
        return <Edit2 className="w-4 h-4 text-blue-500" />
      case 'delete':
        return <Trash2 className="w-4 h-4 text-red-500" />
      default:
        return <FileText className="w-4 h-4 text-gray-500" />
    }
  }

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg w-3/4 h-3/4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">File History</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Filters */}
        <div className="p-4 border-b border-gray-700 space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">From</label>
              <input
                type="datetime-local"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full bg-gray-800 text-white rounded px-3 py-2"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">To</label>
              <input
                type="datetime-local"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full bg-gray-800 text-white rounded px-3 py-2"
              />
            </div>
          </div>
          
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Path</label>
              <input
                type="text"
                value={pathFilter}
                onChange={(e) => setPathFilter(e.target.value)}
                placeholder="Filter by path..."
                className="w-full bg-gray-800 text-white rounded px-3 py-2"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm text-gray-400 mb-1">Change Type</label>
            <div className="flex gap-4">
              {['create', 'modify', 'delete'].map(type => (
                <label key={type} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={changeTypeFilter.includes(type)}
                    onChange={() => handleToggleChangeType(type)}
                    className="rounded bg-gray-800"
                  />
                  <span className="text-gray-300 capitalize">{type}</span>
                </label>
              ))}
            </div>
          </div>
          
          <button
            onClick={() => {
              setFromDate('')
              setToDate('')
              setPathFilter('')
              setChangeTypeFilter([])
              setPage(1)
              loadHistory()
            }}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            Clear filters
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading && entries.length === 0 ? (
            <div className="text-center text-gray-400">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="text-center text-gray-400">
              <FileText className="w-12 h-12 mx-auto mb-2" />
              <p>No history found</p>
              <p className="text-sm">File changes will be tracked automatically</p>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry, index) => (
                <div
                  key={index}
                  onClick={() => setSelectedEntry(entry)}
                  className="flex items-center gap-3 p-3 bg-gray-800 rounded hover:bg-gray-750 cursor-pointer"
                >
                  {getChangeTypeIcon(entry.changeType)}
                  <div className="flex-1">
                    <div className="text-white font-mono">{entry.path}</div>
                    <div className="text-sm text-gray-400 flex items-center gap-2">
                      <Calendar className="w-3 h-3" />
                      {formatDate(entry.timestamp)}
                    </div>
                  </div>
                  <span className="text-sm text-gray-400 capitalize">{entry.changeType}</span>
                </div>
              ))}
              
              {hasMore && (
                <button
                  onClick={() => setPage(p => p + 1)}
                  className="w-full py-2 text-blue-400 hover:text-blue-300"
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Detail View */}
        {selectedEntry && (
          <div className="border-t border-gray-700 p-4 bg-gray-800">
            <h3 className="text-lg font-semibold text-white mb-2">
              {selectedEntry.path}
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Timestamp:</span>
                <span className="text-white ml-2">{formatDate(selectedEntry.timestamp)}</span>
              </div>
              <div>
                <span className="text-gray-400">Change Type:</span>
                <span className="text-white ml-2 capitalize">{selectedEntry.changeType}</span>
              </div>
              <div>
                <span className="text-gray-400">Hash Before:</span>
                <span className="text-white ml-2 font-mono text-xs">
                  {selectedEntry.hashBefore?.substring(0, 16)}...
                </span>
              </div>
              <div>
                <span className="text-gray-400">Hash After:</span>
                <span className="text-white ml-2 font-mono text-xs">
                  {selectedEntry.hashAfter?.substring(0, 16)}...
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
