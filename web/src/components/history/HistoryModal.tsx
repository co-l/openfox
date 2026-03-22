import { useState, useEffect } from 'react'
import { X, FileText, Plus, Trash2, Edit2 } from 'lucide-react'
import { Markdown } from '../shared/Markdown'

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
  const [pathFilter, setPathFilter] = useState('')
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry & { content?: string } | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadHistory()
    }
  }, [isOpen])

  const loadHistory = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        workdir,
        page: '1',
        pageSize: '100',
      })
      
      if (pathFilter) params.append('path', pathFilter)
      
      const response = await fetch(`/api/history?${params}`)
      const data: HistoryResponse = await response.json()
      setEntries(data.entries)
    } catch (error) {
      console.error('Error loading history:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleEntryClick = async (entry: HistoryEntry) => {
    try {
      const response = await fetch(`/api/history/${entry.timestamp}?workdir=${encodeURIComponent(workdir)}`)
      const data = await response.json()
      
      if (data.entry) {
        setSelectedEntry(data.entry)
      }
    } catch (error) {
      console.error('Error loading snapshot:', error)
    }
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

  const filteredEntries = entries.filter(entry => 
    entry.path.toLowerCase().includes(pathFilter.toLowerCase())
  )

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg w-5/6 h-5/6 flex flex-col">
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

        {/* Path Filter */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex-1">
            <label className="block text-sm text-gray-400 mb-1">Filter by path</label>
            <input
              type="text"
              value={pathFilter}
              onChange={(e) => setPathFilter(e.target.value)}
              placeholder="Enter file name..."
              className="w-full bg-gray-800 text-white rounded px-3 py-2"
            />
          </div>
        </div>

        {/* Split View */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Entry List */}
          <div className="w-1/2 overflow-auto p-4 border-r border-gray-700">
            {loading ? (
              <div className="text-center text-gray-400">Loading...</div>
            ) : filteredEntries.length === 0 ? (
              <div className="text-center text-gray-400">
                <FileText className="w-12 h-12 mx-auto mb-2" />
                <p>No history found</p>
                <p className="text-sm">File changes will be tracked automatically</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredEntries.map((entry, index) => (
                  <div
                    key={index}
                    onClick={() => handleEntryClick(entry)}
                    className={`flex items-center gap-3 p-3 rounded cursor-pointer ${
                      selectedEntry?.timestamp === entry.timestamp 
                        ? 'bg-blue-900' 
                        : 'bg-gray-800 hover:bg-gray-750'
                    }`}
                  >
                    {getChangeTypeIcon(entry.changeType)}
                    <div className="flex-1">
                      <div className="text-white font-mono text-sm">{entry.path}</div>
                      <div className="text-xs text-gray-400">{formatDate(entry.timestamp)}</div>
                    </div>
                    <span className="text-xs text-gray-400 capitalize">{entry.changeType}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Panel - File Content */}
          <div className="w-1/2 overflow-auto p-4 bg-gray-950">
            {selectedEntry ? (
              <div>
                <h3 className="text-lg font-semibold text-white mb-2 font-mono">
                  {selectedEntry.path}
                </h3>
                <div className="text-sm text-gray-400 mb-4">
                  {formatDate(selectedEntry.timestamp)} • {selectedEntry.changeType}
                </div>
                
                {selectedEntry.content !== undefined ? (
                  <div className="border border-gray-700 rounded-lg overflow-hidden">
                    <div className="bg-gray-800 px-4 py-2 text-sm text-gray-400 border-b border-gray-700">
                      File Content
                    </div>
                    <div className="p-4">
                      <Markdown 
                        content={`\`\`\`\n${selectedEntry.content}\n\`\`\``} 
                        className="text-sm"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500 italic">
                    No content (file was deleted)
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-gray-500 mt-20">
                <FileText className="w-16 h-16 mx-auto mb-4" />
                <p className="text-lg">Select a file to view its content</p>
                <p className="text-sm mt-2">Click on any entry from the left panel</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
