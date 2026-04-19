import { useEffect, useState } from 'react'
import { useWorkflowsStore, type WorkflowInfo } from '../../stores/workflows'
import { WorkflowsModal } from '../settings/WorkflowsModal'
import { EditButton } from '../shared/IconButton'
import type { Criterion } from '@shared/types.js'
import {
  useSearchableMenu,
  DropdownTrigger,
  SearchInput,
  ListContainer,
  EmptyMessage,
  ManageButton,
} from './SearchableDropdown'

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
      return null
    default:
      return null
  }
}

export function WorkflowMenu({ onSelectWorkflow, onOpenManager, criteria }: WorkflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const defaults = useWorkflowsStore(state => state.defaults)
  const userItems = useWorkflowsStore(state => state.userItems)
  const fetchWorkflows = useWorkflowsStore(state => state.fetchWorkflows)
  const workflows = [...defaults, ...userItems]

  const {
    isOpen: menuOpen,
    search,
    selectedIndex,
    filtered,
    containerRef,
    searchRef,
    handleToggle,
    handleSearchChange,
    handleKeyDown,
  } = useSearchableMenu({
    items: workflows,
    isOpen,
    onOpen: () => setIsOpen(true),
    onClose: () => setIsOpen(false),
    filterFn: (workflow, q) => !q || workflow.name.toLowerCase().includes(q.toLowerCase()),
  })

  useEffect(() => {
    if (isOpen) {
      fetchWorkflows()
    }
  }, [isOpen, fetchWorkflows])

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
      <DropdownTrigger label="Workflows" isOpen={menuOpen} onClick={handleToggle} />

      {menuOpen && (
        <div
          className="absolute bottom-full right-0 mb-1 w-72 bg-bg-secondary border border-border rounded-lg shadow-xl z-50"
          onKeyDown={handleKeyDown}
        >
          <SearchInput
            value={search}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
            ref={searchRef}
            placeholder="Search workflows..."
          />

          <ListContainer>
            {filtered.length === 0 ? (
              <EmptyMessage hasItems={workflows.length > 0} message="No workflows yet" />
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
          </ListContainer>

          <ManageButton label="Manage Workflows..." onClick={handleManage} />
        </div>
      )}

      <WorkflowsModal isOpen={!!editId} onClose={() => setEditId(null)} initialEditId={editId} />
    </div>
  )
}