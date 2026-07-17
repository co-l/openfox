import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { MetadataEntry } from '@shared/types.js'
import { authFetch } from '../../lib/api'
import { PlusIcon, XCloseIcon, TrashIcon, InfoIcon } from '../shared/icons'
import { Modal } from '../shared/Modal'
import { MetadataStatusIcon, decodeHtmlEntities } from '../shared/MetadataStatusIcon'
import { useAgentsStore, getAgentColor } from '../../stores/agents'
import { useWorkflowsStore } from '../../stores/workflows'

const statusCycle: Record<string, string> = {
  pending: 'completed',
  completed: 'passed',
  passed: 'failed',
  failed: 'pending',
}

interface CriteriaEditorProps {
  entries: MetadataEntry[]
  sessionId: string
}

async function putCriteria(sessionId: string, entries: MetadataEntry[]) {
  await authFetch(`/api/sessions/${sessionId}/criteria`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ criteria: entries }),
  })
}

function AgentBadge({ id, agents }: { id: string; agents: import('../../stores/agents').AgentInfo[] }) {
  const color = getAgentColor(agents, id)
  const agent = agents.find((a) => a.id === id)
  return (
    <span className="font-medium rounded px-1" style={{ backgroundColor: `${color}20`, color }}>
      {agent?.name ?? id}
    </span>
  )
}

function WorkflowBadge({ id }: { id: string }) {
  const defaults = useWorkflowsStore((s) => s.defaults)
  const userItems = useWorkflowsStore((s) => s.userItems)
  const workflows = useMemo(() => [...defaults, ...userItems], [defaults, userItems])
  const workflow = workflows.find((w) => w.id === id)
  const color = workflow?.color ?? '#3b82f6'
  return (
    <span className="font-medium rounded px-1" style={{ backgroundColor: `${color}20`, color }}>
      {workflow?.name ?? id}
    </span>
  )
}

export function CriteriaEditor({ entries, sessionId }: CriteriaEditorProps) {
  const [criteria, setCriteria] = useState<MetadataEntry[]>(entries)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newDescription, setNewDescription] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [clearConfirm, setClearConfirm] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const defaults = useAgentsStore((s) => s.defaults)
  const userItems = useAgentsStore((s) => s.userItems)
  const projectItems = useAgentsStore((s) => s.projectItems)
  const agents = useMemo(() => [...defaults, ...userItems, ...projectItems], [defaults, userItems, projectItems])
  const addInputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setCriteria(entries)
  }, [entries])

  useEffect(() => {
    if (adding) addInputRef.current?.focus()
  }, [adding])

  useEffect(() => {
    if (editingId) editInputRef.current?.focus()
  }, [editingId])

  const syncToServer = useCallback(
    (next: MetadataEntry[]) => {
      setCriteria(next)
      putCriteria(sessionId, next)
    },
    [sessionId],
  )

  const addCriteria = useCallback(
    (descriptions: string[]) => {
      const cleaned = descriptions.map((description) => description.trim()).filter(Boolean)
      if (cleaned.length === 0) return

      const numericIds = criteria
        .map((criterion) => Number(criterion.id))
        .filter((id) => Number.isInteger(id) && id >= 0)
      const firstId = Math.max(-1, ...numericIds) + 1
      const added = cleaned.map((description, index) => ({
        id: String(firstId + index),
        description,
        status: 'pending',
      }))

      syncToServer([...criteria, ...added])
      setNewDescription('')
      addInputRef.current?.focus()
    },
    [criteria, syncToServer],
  )

  const handleAdd = useCallback(() => {
    addCriteria([newDescription])
  }, [addCriteria, newDescription])

  const handleAddPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const lines = e.clipboardData.getData('text/plain').split(/\r\n|\r|\n/)
      if (lines.length < 2) return

      e.preventDefault()
      addCriteria(lines)
    },
    [addCriteria],
  )

  const handleCancelAdd = useCallback(() => {
    setAdding(false)
    setNewDescription('')
  }, [])

  const handleStartEdit = useCallback((id: string, desc: string) => {
    setEditingId(id)
    setEditDescription(desc)
  }, [])

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return
    const desc = editDescription.trim()
    const next = criteria.map((c) => (c.id === editingId ? { ...c, description: desc || c.description } : c))
    syncToServer(next)
    setEditingId(null)
  }, [editingId, editDescription, criteria, syncToServer])

  const handleCycleStatus = useCallback(
    (id: string) => {
      const next = criteria.map((c) => (c.id === id ? { ...c, status: statusCycle[c.status] ?? 'pending' } : c))
      syncToServer(next)
    },
    [criteria, syncToServer],
  )

  const handleDelete = useCallback(
    (id: string) => {
      syncToServer(criteria.filter((c) => c.id !== id))
    },
    [criteria, syncToServer],
  )

  const handleClearAll = useCallback(() => {
    syncToServer([])
    setClearConfirm(false)
  }, [syncToServer])

  const handleAddKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleAdd()
      }
      if (e.key === 'Escape') {
        handleCancelAdd()
      }
    },
    [handleAdd, handleCancelAdd],
  )

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSaveEdit()
      if (e.key === 'Escape') {
        setEditingId(null)
      }
    },
    [handleSaveEdit],
  )

  return (
    <div className="my-1 rounded border border-border bg-secondary overflow-hidden">
      {/* List items */}
      <div className="bg-primary">
        {criteria.length === 0 && !adding && (
          <div className="px-1.5 py-2 text-xs text-text-muted italic text-center">
            No criteria yet.{' '}
            <button
              onClick={() => setShowInfo(true)}
              className="text-accent-primary hover:underline not-italic cursor-pointer"
            >
              Learn more
            </button>
          </div>
        )}
        {criteria.map((entry, idx) => {
          const status = entry.status
          const isEditing = editingId === entry.id
          return (
            <div
              key={entry.id}
              className={`flex items-start gap-1 px-1.5 py-1 group ${idx > 0 ? 'border-t border-border' : ''}`}
            >
              <button
                onClick={() => handleCycleStatus(entry.id)}
                className="text-xs leading-tight flex-shrink-0 cursor-pointer hover:opacity-70 transition-opacity"
                title={`Status: ${entry.status} (click to cycle)`}
              >
                <MetadataStatusIcon status={status} />
              </button>
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    onBlur={handleSaveEdit}
                    onKeyDown={handleEditKeyDown}
                    className="w-full bg-bg-tertiary text-text-primary text-xs px-1.5 py-0.5 rounded border border-border focus:outline-none focus:border-accent-primary"
                  />
                ) : (
                  <button
                    onClick={() => handleStartEdit(entry.id, entry.description)}
                    className="text-xs text-text-primary text-left hover:text-accent-primary transition-colors w-full truncate cursor-pointer"
                    title="Click to edit"
                  >
                    [{entry.id}] {decodeHtmlEntities(entry.description)}
                  </button>
                )}
              </div>
              <button
                onClick={() => handleDelete(entry.id)}
                className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-error transition-all ml-0.5 cursor-pointer flex items-center self-center"
                title="Delete criterion"
              >
                <XCloseIcon className="w-4 h-4" />
              </button>
            </div>
          )
        })}
      </div>

      {/* Add input row */}
      {adding && (
        <div className="px-1.5 py-1 border-t border-border bg-secondary">
          <div className="flex items-center gap-1">
            <span className="text-text-muted text-xs leading-tight flex-shrink-0">○</span>
            <input
              ref={addInputRef}
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              onKeyDown={handleAddKeyDown}
              onPaste={handleAddPaste}
              placeholder="New criterion..."
              className="flex-1 bg-bg-tertiary text-text-primary text-xs px-1.5 py-0.5 rounded border border-border focus:outline-none focus:border-accent-primary placeholder-text-muted"
            />
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div className="px-1.5 py-1 border-t border-border bg-secondary flex items-center gap-2">
        {adding ? (
          <>
            <button
              onClick={handleAdd}
              className="flex items-center gap-1 text-xs text-accent-primary hover:text-accent-primary/70 transition-colors cursor-pointer"
              title="Add criterion"
            >
              <PlusIcon className="w-3 h-3" />
              Add
            </button>
            <button
              onClick={handleCancelAdd}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              title="Cancel"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-accent-primary transition-colors cursor-pointer"
            title="Add criterion"
          >
            <PlusIcon className="w-3 h-3" />
            Add
          </button>
        )}
        {criteria.length > 0 && (
          <button
            onClick={() => setClearConfirm(true)}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-accent-error transition-colors ml-auto cursor-pointer"
            title="Clear all criteria"
          >
            <TrashIcon className="w-3 h-3" />
            Clear all
          </button>
        )}
        <button
          onClick={() => setShowInfo(true)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-accent-primary transition-colors cursor-pointer"
          title="About criteria"
        >
          <InfoIcon className="w-3 h-3" />
        </button>
      </div>

      {/* Clear all confirmation */}
      {clearConfirm && (
        <div className="px-1.5 py-1 border-t border-border bg-secondary">
          <div className="flex items-center gap-2 justify-between">
            <span className="text-xs text-accent-error">Clear all criteria?</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearAll}
                className="text-xs text-accent-error hover:text-accent-error/70 transition-colors cursor-pointer"
              >
                Yes
              </button>
              <button
                onClick={() => setClearConfirm(false)}
                className="text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info modal */}
      <Modal isOpen={showInfo} onClose={() => setShowInfo(false)} title="About Acceptance Criteria" size="md">
        <div className="space-y-3 text-sm text-text-secondary">
          <p>Each criterion defines a specific requirement that needs to be met.</p>
          <p>
            To use this feature, start in <AgentBadge id="planner" agents={agents} /> mode and
            <strong className="text-text-primary">
              {' '}
              ask the agent to define acceptance criteria that matches your goal
            </strong>
            . Then launch the <WorkflowBadge id="default" /> builtin workflow to launch the automation part.
          </p>
          <p>This workflow will automatically:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>
              Launch the <AgentBadge id="builder" agents={agents} /> agent, that will be forced to continue until it
              marks all criteria as "completed"
            </li>
            <li>
              Then launch the <AgentBadge id="verifier" agents={agents} /> subagent, that will verify each criterion. If
              every criterion is fulfilled, then it goes to the next step, otherwise, it gives feedback to the main
              agent until 100% of the criteria are met.
            </li>
            <li>
              Launch a <AgentBadge id="code_reviewer" agents={agents} /> subagent, that will analyze the code to provide
              actionable feedback to the main agent.
            </li>
          </ol>
          <div className="bg-bg-tertiary rounded p-3 space-y-1.5">
            <p>
              This lets smaller models follow complex plans to completion and improves the chances that nothing from
              your plan is missed.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  )
}
