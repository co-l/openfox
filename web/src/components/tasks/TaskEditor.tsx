import { useState, useRef, useEffect, useCallback } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { Button } from '../shared/Button'
import { AttachmentPreview } from '../shared/AttachmentPreview'
import { ModelPicker } from '../shared/ModelPicker'
import { SlashAutocomplete, type SlashAutocompleteHandle, type SlashSuggestion } from '../shared/SlashAutocomplete'
import {
  AtMentionAutocomplete,
  type AtMentionAutocompleteHandle,
  type FileSuggestion,
} from '../shared/AtMentionAutocomplete'
import { AttachIcon } from '../shared/icons'
import { useTasksStore } from '../../stores/tasks'
import { useAgents } from '../../hooks/useAgents'
import { useConfigStore } from '../../stores/config'
import { useWorkflowsStore, selectAllWorkflows } from '../../stores/workflows'
import { useCommandsStore } from '../../stores/commands'
import { useProjectStore } from '../../stores/project'
import { dedupById } from '../../lib/modal-utils'
import { authFetch } from '../../lib/api'
import { insertSuggestionAtCursor, focusTextareaAt, resolveSlashParamIds } from '../../lib/composer-utils'
import { processFile } from '../../lib/file-processing'
import type { ProjectTask, Attachment } from '@shared/types.js'

interface TaskEditorProps {
  projectId: string
  initialTask?: ProjectTask | null
  onClose: () => void
  onSaved: (task: ProjectTask) => void
}

const DRAFT_KEY = 'openfox:task-draft'

/**
 * Task create/edit composer. Mirrors the chat composer's capabilities — drafts,
 * undo, slash commands & workflows with inline parameter hints, @-mentions,
 * attachments, and agent/model selection — with one deliberate difference:
 * Shift+Enter submits, while plain Enter inserts a newline (inverted from chat).
 */
export function TaskEditor({ projectId, initialTask, onClose, onSaved }: TaskEditorProps) {
  const isEdit = !!initialTask
  const createTask = useTasksStore((state) => state.createTask)
  const updateTask = useTasksStore((state) => state.updateTask)
  const lastError = useTasksStore((state) => state.lastError)

  const { agents: allAgents, fetchAgents } = useAgents()
  const agents = allAgents.filter((a) => !a.subagent)
  const providers = useConfigStore((state) => state.providers)
  const projects = useProjectStore((state) => state.projects)
  const workdir = projects.find((p) => p.id === projectId)?.workdir

  // Agents load lazily (chat composer, settings…). The editor must own its own
  // fetch so the dropdown is populated even when opened from the homepage.
  useEffect(() => {
    void fetchAgents()
  }, [fetchAgents])

  const draftKey = `${DRAFT_KEY}:${projectId}:${initialTask?.id ?? 'new'}`

  const [prompt, setPrompt] = useState(() => initialTask?.prompt ?? '')
  const [attachments, setAttachments] = useState<Attachment[]>(() => initialTask?.attachments ?? [])
  const [agentId, setAgentId] = useState<string | undefined>(() => initialTask?.agentId ?? undefined)
  const [providerId, setProviderId] = useState<string | undefined>(() => initialTask?.providerId)
  const [model, setModel] = useState<string | undefined>(() => initialTask?.model)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [activeSlashParams, setActiveSlashParams] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<AtMentionAutocompleteHandle>(null)
  const slashAutocompleteRef = useRef<SlashAutocompleteHandle>(null)
  const cursorPosRef = useRef(0)
  // Undo stack for prompt edits (composer parity).
  const undoStackRef = useRef<string[]>([])
  const [canUndo, setCanUndo] = useState(false)

  // Resolve the project workdir for @-mention search when not loaded yet.
  useEffect(() => {
    if (workdir) return
    let cancelled = false
    authFetch(`/api/projects/${projectId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.project?.workdir) {
          useProjectStore.setState({ currentProject: data.project })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId, workdir])

  // Restore an unsaved draft (create OR edit) so closing the editor midway
  // never loses work. Keyed by task id, so each task keeps its own draft.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) {
        const draft = JSON.parse(raw) as { prompt?: string }
        if (draft.prompt) {
          setPrompt(draft.prompt)
        }
      }
    } catch {
      /* ignore corrupt drafts */
    }
  }, [])

  // Persist unsaved draft on every change.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ prompt }))
      } catch {
        /* quota */
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [prompt, draftKey])

  const addFiles = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      void processFile(
        file,
        (attachment) => setAttachments((prev) => [...prev, attachment]),
        (error) => setErrorMessage(error),
      )
    }
  }, [])

  const onPaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData.files.length > 0) {
      addFiles(e.clipboardData.files)
    }
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files)
    }
  }

  // Undo: remember the previous value before each committed prompt change.
  const recordUndo = (previous: string) => {
    undoStackRef.current.push(previous)
    if (undoStackRef.current.length > 50) undoStackRef.current.shift()
    setCanUndo(true)
  }

  const handlePromptChange = (value: string) => {
    if (value !== prompt) {
      recordUndo(prompt)
      setPrompt(value)
    }
  }

  const undoPrompt = () => {
    const previous = undoStackRef.current.pop()
    if (previous === undefined) return
    setPrompt(previous)
    setCanUndo(undoStackRef.current.length > 0)
    textareaRef.current?.focus()
  }

  const handleSelectSlash = useCallback(
    (suggestion: SlashSuggestion, startIndex: number) => {
      const { newText, newCursorPos } = insertSuggestionAtCursor(
        prompt,
        cursorPosRef.current,
        startIndex,
        `/${suggestion.id} `,
      )
      recordUndo(prompt)
      setPrompt(newText)
      cursorPosRef.current = newCursorPos
      focusTextareaAt(textareaRef.current, newCursorPos)
      // Inline parameter hints, exactly as in chat.
      setActiveSlashParams(resolveSlashParamIds(suggestion))
    },
    [prompt],
  )

  const handleSelectFile = useCallback(
    (suggestion: FileSuggestion, startIndex: number) => {
      const isDirectory = suggestion.type === 'directory'
      const suffix = isDirectory ? '/' : ' '
      const { newText, newCursorPos } = insertSuggestionAtCursor(
        prompt,
        cursorPosRef.current,
        startIndex,
        `@${suggestion.path}${suffix}`,
      )
      recordUndo(prompt)
      setPrompt(newText)
      cursorPosRef.current = newCursorPos
      focusTextareaAt(textareaRef.current, newCursorPos)
    },
    [prompt],
  )

  const save = async () => {
    const hasText = prompt.trim().length > 0
    const hasAttachments = attachments.length > 0
    if (!hasText && !hasAttachments) {
      setErrorMessage('Add a prompt or an attachment')
      return
    }
    setSaving(true)
    setErrorMessage(null)
    const input: {
      prompt: string
      attachments?: Attachment[]
      agentId?: string | null
      providerId?: string | null
      model?: string | null
    } = {
      prompt,
      ...(attachments.length > 0 ? { attachments } : {}),
      // Edits can unpin an agent back to the default (null clears it server-side);
      // creates only pin an agent when one was explicitly chosen.
      ...(isEdit ? { agentId: agentId ?? null } : agentId ? { agentId } : {}),
      // Edits can unpin a previously pinned provider/model back to the defaults —
      // null clears it server-side; creates only pin when explicitly chosen.
      ...(isEdit && initialTask?.providerId && !providerId ? { providerId: null } : providerId ? { providerId } : {}),
      ...(isEdit && initialTask?.model && !model ? { model: null } : model ? { model } : {}),
    }
    const saved = isEdit
      ? await updateTask(projectId, initialTask!.id, input as Parameters<typeof updateTask>[2])
      : await createTask(projectId, input as Parameters<typeof createTask>[1])
    setSaving(false)
    if (saved) {
      try {
        localStorage.removeItem(draftKey)
      } catch {
        /* ignore */
      }
      onSaved(saved)
    } else {
      setErrorMessage(lastError ?? 'Could not save the task')
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashAutocompleteRef.current?.handleKeyDown(e)) return
    if (autocompleteRef.current?.handleKeyDown(e)) return

    if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      undoPrompt()
      return
    }
    if (e.key === 'Enter' && e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void save()
    }
  }

  const workflows = (() => selectAllWorkflows(useWorkflowsStore.getState()))()
  const commands = (() => {
    const s = useCommandsStore.getState()
    return dedupById(dedupById(s.defaults, s.userItems), s.projectItems)
  })()

  const slashParamCount = (() => {
    if (activeSlashParams.length === 0) return 0
    const match = prompt.match(/\/(\w+)\s+(.*)$/)
    const args = match ? match[2]!.trim().split(/\s+/) : []
    const filledCount = args.filter(Boolean).length
    const nextParam = activeSlashParams[filledCount]
    return nextParam ? activeSlashParams.length - filledCount : 0
  })()

  const modelValue = providerId && model ? `${providerId}/${model}` : undefined
  const isAlreadyRunning = isEdit && initialTask!.status === 'in_progress' && initialTask!.runState === 'running'

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Edit task' : 'New task'}
      size="lg"
      showCloseButton
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-text-muted truncate">
            {isAlreadyRunning
              ? 'This task is already in progress — changes apply to the next run.'
              : 'Shift+Enter to save · Enter for a new line'}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create task'}
            </Button>
          </div>
        </div>
      }
    >
      {isAlreadyRunning && (
        <div className="mb-3 px-3 py-2 rounded bg-accent-primary/10 border border-accent-primary/30 text-sm text-text-primary">
          This task is already in progress — changes apply to the next run.
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-text-muted mb-1">Prompt</label>
          <div className="relative" onDragOver={onDragOver} onDrop={onDrop}>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              onSelect={(e) => {
                cursorPosRef.current = e.currentTarget.selectionStart
              }}
              onPaste={onPaste}
              onKeyDown={onKeyDown}
              rows={6}
              placeholder={
                'Describe the task. Slash commands (/cmd) and workflows resolve exactly as in chat when the task launches.'
              }
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary resize-y min-h-32"
            />
            <AtMentionAutocomplete
              ref={autocompleteRef}
              text={prompt}
              cursorPos={cursorPosRef.current}
              workdir={workdir}
              onSelect={handleSelectFile}
            />
            <SlashAutocomplete
              ref={slashAutocompleteRef}
              text={prompt}
              cursorPos={cursorPosRef.current}
              workflows={workflows}
              commands={commands}
              onSelect={handleSelectSlash}
            />
            {activeSlashParams.length > 0 && slashParamCount > 0 && (
              <div className="absolute top-2 right-14 text-xs text-text-muted bg-bg-secondary/90 border border-border rounded px-2 py-1">
                {slashParamCount} required param{slashParamCount > 1 ? 's' : ''} — tab through after the command
              </div>
            )}
            <div className="absolute bottom-2 right-2 flex items-center gap-1">
              <button
                type="button"
                onClick={undoPrompt}
                disabled={!canUndo}
                className="p-1.5 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                title="Undo (Ctrl+Z)"
              >
                ↩︎
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors"
                title="Attach files"
              >
                <AttachIcon />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        </div>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <AttachmentPreview
                key={attachment.id}
                attachment={attachment}
                onRemove={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
              />
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Agent</label>
            <select
              value={agentId ?? ''}
              onChange={(e) => setAgentId(e.target.value || undefined)}
              className="w-full px-3 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary"
            >
              <option value="">Default agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Model</label>
            <ModelPicker
              providers={providers}
              value={modelValue}
              onChange={(v) => {
                if (v) {
                  const slash = v.indexOf('/')
                  setProviderId(v.slice(0, slash))
                  setModel(v.slice(slash + 1))
                } else {
                  setProviderId(undefined)
                  setModel(undefined)
                }
              }}
            />
          </div>
        </div>

        {errorMessage && <div className="text-sm text-accent-error">{errorMessage}</div>}
      </div>
    </Modal>
  )
}
