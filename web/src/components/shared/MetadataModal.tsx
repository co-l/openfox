import { useState, useCallback, useRef, useEffect } from 'react'
import type { MetadataEntry } from '@shared/types.js'
import { authFetch } from '../../lib/api'
import { Modal } from './Modal'
import { MetadataStatusIcon, decodeHtmlEntities } from './MetadataStatusIcon'
import { PlusIcon, XCloseIcon } from './icons'

const STATUS_CYCLES: Record<string, string[]> = {
  criteria: ['pending', 'completed', 'passed', 'failed'],
  todos: ['pending', 'in_progress', 'completed'],
  review_findings: ['open', 'resolved', 'dismissed'],
}

const GENERIC_CYCLE = ['pending', 'completed', 'failed', 'dismissed']

function getStatusCycle(key: string): string[] {
  return STATUS_CYCLES[key] ?? GENERIC_CYCLE
}

function cycleStatus(current: string, cycle: string[]): string {
  const idx = cycle.indexOf(current)
  if (idx === -1) return cycle[0] ?? 'pending'
  const next = cycle[(idx + 1) % cycle.length]
  return next ?? 'pending'
}

interface MetadataModalProps {
  entries: MetadataEntry[]
  sessionId: string
  metadataKey: string
  title: string
  isOpen: boolean
  onClose: () => void
}

export function MetadataModal({
  entries: initialEntries,
  sessionId,
  metadataKey,
  title,
  isOpen,
  onClose,
}: MetadataModalProps) {
  const [entries, setEntries] = useState<MetadataEntry[]>(initialEntries)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDescription, setEditDescription] = useState('')
  const [adding, setAdding] = useState(false)
  const [newDescription, setNewDescription] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLTextAreaElement>(null)

  const autoResize = useCallback(() => {
    const el = editInputRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  }, [])

  useEffect(() => {
    setEntries(initialEntries)
  }, [initialEntries])

  useEffect(() => {
    if (editingId) {
      autoResize()
      editInputRef.current?.focus()
    }
  }, [editingId, autoResize])

  useEffect(() => {
    if (adding) addInputRef.current?.focus()
  }, [adding])

  const syncToServer = useCallback(
    (next: MetadataEntry[]) => {
      setEntries(next)
      authFetch(`/api/sessions/${sessionId}/metadata/${metadataKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: next }),
      }).catch((e) => console.error(`Failed to sync ${metadataKey}:`, e))
    },
    [sessionId, metadataKey],
  )

  const handleCycleStatus = useCallback(
    (id: string) => {
      const cycle = getStatusCycle(metadataKey)
      const next = entries.map((e) => (e.id === id ? { ...e, status: cycleStatus(e.status, cycle) } : e))
      syncToServer(next)
    },
    [entries, metadataKey, syncToServer],
  )

  const handleStartEdit = useCallback((id: string, desc: string) => {
    setEditingId(id)
    setEditDescription(desc)
  }, [])

  const commitEdit = useCallback((id: string, desc: string, current: MetadataEntry[]) => {
    const trimmed = (desc.trim() || current.find((e) => e.id === id)?.description) ?? ''
    const next = current.map((e) => (e.id === id ? { ...e, description: trimmed } : e))
    syncToServer(next)
  }, [syncToServer])

  const handleSaveEdit = useCallback(() => {
    if (!editingId) return
    commitEdit(editingId, editDescription, entries)
    setEditingId(null)
  }, [editingId, editDescription, entries, commitEdit])

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSaveEdit()
      if (e.key === 'Escape') {
        e.stopPropagation()
        setEditingId(null)
      }
    },
    [handleSaveEdit],
  )

  const handleDelete = useCallback(
    (id: string) => {
      syncToServer(entries.filter((e) => e.id !== id))
    },
    [entries, syncToServer],
  )

  const handleAdd = useCallback(() => {
    const desc = newDescription.trim()
    if (!desc) return

    const numericIds = entries.map((e) => Number(e.id)).filter((id) => Number.isInteger(id) && id >= 0)
    const nextId = String(Math.max(-1, ...numericIds) + 1)

    syncToServer([...entries, { id: nextId, description: desc, status: 'pending' }])
    setNewDescription('')
  }, [newDescription, entries, syncToServer])

  const handleAddKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleAdd()
      }
      if (e.key === 'Escape') {
        setAdding(false)
        setNewDescription('')
      }
    },
    [handleAdd],
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="full" showCloseButton={true} closeOnEscape={true}>
      <ul className="space-y-1">
        {entries.map((entry, idx) => {
          const isEditing = editingId === entry.id
          const label = (
            <button
              onClick={() => handleStartEdit(entry.id, entry.description)}
              className="text-sm text-text-primary text-left hover:text-accent-primary transition-colors w-full cursor-pointer"
              title="Click to edit"
            >
              <span className="text-text-muted">[{entry.id}]</span>{' '}
              <span>{decodeHtmlEntities(entry.description)}</span>
            </button>
          )
          const editor = isEditing ? (
            <textarea
              ref={editInputRef}
              value={editDescription}
              onChange={(e) => {
                setEditDescription(e.target.value)
                autoResize()
              }}
              onBlur={handleSaveEdit}
              onKeyDown={handleEditKeyDown}
              className="w-full bg-bg-tertiary text-text-primary text-sm px-2 py-1 rounded border border-border focus:outline-none focus:border-accent-primary resize-none"
              rows={1}
            />
          ) : label
          return (
            <li
              key={entry.id}
              className={`flex items-start gap-2 px-2 py-1.5 ${idx > 0 ? 'border-t border-border' : ''}`}
            >
              <button
                onClick={() => handleCycleStatus(entry.id)}
                className="flex-shrink-0 cursor-pointer hover:opacity-70 transition-opacity mt-0.5"
                title="Click to cycle status"
              >
                <MetadataStatusIcon status={entry.status} />
              </button>
              <div className="flex-1 min-w-0">{editor}</div>
              <button
                onClick={() => handleDelete(entry.id)}
                className="flex-shrink-0 text-text-muted hover:text-accent-error transition-colors cursor-pointer mt-0.5 ml-auto"
                title="Delete entry"
              >
                <span className="flex"><XCloseIcon className="w-4 h-4" /></span>
              </button>
            </li>
          )
        })}
        {entries.length === 0 && <p className="text-sm text-text-muted italic text-center py-4">No entries yet.</p>}
      </ul>

      <div className="mt-4 pt-3 border-t border-border">
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-sm leading-tight">○</span>
          <input
            ref={addInputRef}
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            onKeyDown={handleAddKeyDown}
            placeholder="New entry..."
            className="flex-1 bg-bg-tertiary text-text-primary text-sm px-2 py-1 rounded border border-border focus:outline-none focus:border-accent-primary placeholder-text-muted"
          />
          <button
            onClick={handleAdd}
            className="flex items-center gap-1 text-sm text-accent-primary hover:text-accent-primary/70 transition-colors cursor-pointer"
            title="Add entry"
          >
            <PlusIcon className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>
    </Modal>
  )
}
