import { useEffect, useRef, useState } from 'react'
import { useWorkflowsStore, type WorkflowInfo } from '../../stores/workflows'
import { WorkflowsModal } from '../settings/WorkflowsModal'
import { EditButton } from '../shared/IconButton'
import type { Criterion } from '@shared/types.js'

interface WorkflowMenuProps {
  onSelectWorkflow: (workflowId: string) => void
  onOpenManager: () => void
  criteria: Criterion[]
}

function isConditionMet(workflow: WorkflowInfo, criteria: Criterion[]): boolean | null {
  const cond = workflow.startCondition
  if (!cond || cond.type === 'always') return true
  switch (cond.type) {
    case 'has_pending_criteria':
      return criteria.some(c => c.status.type !== 'passed')
    case 'all_criteria_passed':
      return criteria.length === 0 || criteria.every(c => c.status.type === 'passed')
    case 'all_criteria_completed_or_passed':
      return criteria.every(c => c.status.type === 'completed' || c.status.type === 'passed')
    case 'any_criteria_blocked':
      return criteria.some(c =>
        c.status.type === 'failed' &&
        c.attempts.filter(a => a.status === 'failed').length >= 4
      )
    case 'step_result':
      return null // server-side only, unknown
    default:
      return null
  }
}

export function WorkflowMenu({ onSelectWorkflow, onOpenManager, criteria }: WorkflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [editId, setEditId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const workflows = useWorkflowsStore(state => state.workflows)
  const fetchWorkflows = useWorkflowsStore(state => state.fetchWorkflows)

  useEffect(() => {
    if (isOpen) {
      fetchWorkflows()
      setSearch('')
      setSelectedIndex(0)
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [isOpen, fetchWorkflows])

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const filtered = workflows.filter(w => {
    if (!search) return true
    const q = search.toLowerCase()
    return w.name.toLowerCase().includes(q)
  })

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filtered[selectedIndex]) {
          handleSelect(filtered[selectedIndex].id)
        }
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        break
    }
  }

  const handleSelect = (workflowId: string) => {
    onSelectWorkflow(workflowId)
    setIsOpen(false)
  }

  const handleManage = () => {
    setIsOpen(false)
    onOpenManager()
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        className="text-sm text-text-muted hover:text-text-primary transition-colors"
      >
        Workflows &darr;
      </button>

      {isOpen && (
        <div
          className="absolute bottom-full right-0 mb-1 w-72 bg-bg-secondary border border-border rounded-lg shadow-xl z-50"
          onKeyDown={handleKeyDown}
        >
          {/* Search */}
          <div className="p-2 border-b border-border">
            <input
              ref={searchRef}
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setSelectedIndex(0)
              }}
              placeholder="Search workflows..."
              className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
          </div>

          {/* Workflow list */}
          <div className="overflow-y-auto max-h-64 p-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-text-muted text-sm">
                {workflows.length === 0 ? 'No workflows yet' : 'No matches'}
              </div>
            ) : (
              filtered.map((workflow, index) => {
                const condMet = isConditionMet(workflow, criteria)
                const color = workflow.color ?? '#3b82f6'
                return (
                  <div
                    key={workflow.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded transition-colors group ${
                      index === selectedIndex
                        ? 'bg-accent-primary/20'
                        : 'hover:bg-bg-tertiary'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(workflow.id)}
                      className="flex-1 text-left flex items-center gap-2"
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm text-text-primary font-medium flex-1">{workflow.name}</span>
                      {condMet !== null && (
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: condMet ? '#22c55e' : '#6b7280' }}
                          title={condMet ? 'Entry condition met' : 'Entry condition not met'}
                        />
                      )}
                    </button>
                    <EditButton
                      className="opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation()
                        setIsOpen(false)
                        setEditId(workflow.id)
                      }}
                    />
                  </div>
                )
              })
            )}
          </div>

          {/* Manage button */}
          <div className="border-t border-border p-1">
            <button
              type="button"
              onClick={handleManage}
              className="w-full text-left px-3 py-1.5 rounded text-sm text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors"
            >
              Manage Workflows...
            </button>
          </div>
        </div>
      )}

      <WorkflowsModal isOpen={!!editId} onClose={() => setEditId(null)} initialEditId={editId} />
    </div>
  )
}
