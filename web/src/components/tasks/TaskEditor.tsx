import { useState, useRef, useEffect, useCallback } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { AttachmentPreview } from '../shared/AttachmentPreview'
import { ModelPicker } from '../shared/ModelPicker'
import { SaveCancelButtons } from '../shared/SaveCancelButtons'
import { SlashAutocomplete, type SlashAutocompleteHandle, type SlashSuggestion } from '../shared/SlashAutocomplete'
import {
  AtMentionAutocomplete,
  type AtMentionAutocompleteHandle,
  type FileSuggestion,
} from '../shared/AtMentionAutocomplete'
import { AttachIcon } from '../shared/icons'
import { useTasksStore } from '../../stores/tasks'
import { useAgents } from '../../hooks/useAgents'
import { useProviders } from '../../hooks/useProviders'
import { useResource } from '../../hooks/useResource'
import { commandsResource, projectResource, workflowsResource, selectAllWorkflows } from '../../lib/resources'
import { useProjectStore } from '../../stores/project'
import { useProjects } from '../../hooks/useProjects'
import { dedupById } from '../../lib/modal-utils'
import { insertSuggestionAtCursor, focusTextareaAt, resolveSlashParamIds } from '../../lib/composer-utils'
import { processFile } from '../../lib/file-processing'
import { toLocalInput, fromLocalInput, weekdayLabel, monthLabel } from '../../lib/schedule-format'
import type { ProjectTask, Attachment, TaskSchedule } from '@shared/types.js'
import { useT } from '../../hooks/useT'

interface TaskEditorProps {
  projectId: string
  initialTask?: ProjectTask | null
  onClose: () => void
  onSaved: (task: ProjectTask) => void
}

const DRAFT_KEY = 'openfox:task-draft'

// Height buffer added on top of the measured content height so the textarea
// never shows an internal scrollbar from sub-pixel overflow rounding.
const TEXTAREA_RESIZE_PAD = 8

type ScheduleMode = 'none' | 'once' | 'recurring'
type RecurFreq = 'day' | 'week' | 'month' | 'year'
type RecurEndKind = 'never' | 'until' | 'count'

const FREQ_OPTIONS: { value: RecurFreq; en: string; fr: string }[] = [
  { value: 'day', en: 'day(s)', fr: 'jour(s)' },
  { value: 'week', en: 'week(s)', fr: 'semaine(s)' },
  { value: 'month', en: 'month(s)', fr: 'mois' },
  { value: 'year', en: 'year(s)', fr: 'année(s)' },
]

/** Weekday chip order, Monday first (values follow Date.getDay(): 0 = Sunday). */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

/**
 * User-controlled schedule rule (everything except the server-owned
 * occurrencesDone / nextRunAt bookkeeping), normalized to instants so string
 * serialization differences never mask an actual rule change.
 */
function scheduleSignature(schedule: TaskSchedule): unknown {
  if (schedule.type === 'once') return { type: 'once', runAt: new Date(schedule.runAt).getTime() }
  return {
    type: 'recurring',
    freq: schedule.freq,
    interval: schedule.interval,
    ...(schedule.weekdays ? { weekdays: [...schedule.weekdays].sort() } : {}),
    ...(schedule.monthDay !== undefined ? { monthDay: schedule.monthDay } : {}),
    ...(schedule.yearMonth !== undefined ? { yearMonth: schedule.yearMonth } : {}),
    startAt: new Date(schedule.startAt).getTime(),
    end:
      schedule.end.kind === 'until' ? { kind: 'until', until: new Date(schedule.end.until).getTime() } : schedule.end,
  }
}

/** Shared day-of-month picker for monthly and yearly repeat-on selectors. */
function DayOfMonthInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number
  onChange: (v: number) => void
  ariaLabel: string
}) {
  return (
    <input
      type="number"
      min={1}
      max={31}
      value={value}
      onChange={(e) => onChange(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
      aria-label={ariaLabel}
      className="w-20 px-3 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary"
    />
  )
}

/**
 * Task create/edit composer. Mirrors the chat composer's capabilities — drafts,
 * undo, slash commands & workflows with inline parameter hints, @-mentions,
 * attachments, and agent/model selection — with one deliberate difference:
 * Ctrl+Enter submits, while plain Enter and Shift+Enter insert newlines
 * (inverted from chat).
 */
export function TaskEditor({ projectId, initialTask, onClose, onSaved }: TaskEditorProps) {
  const t = useT()
  const isEdit = !!initialTask
  const createTask = useTasksStore((state) => state.createTask)
  const updateTask = useTasksStore((state) => state.updateTask)
  const lastError = useTasksStore((state) => state.lastError)

  const { providers } = useProviders()
  const { projects } = useProjects()
  const workdir = projects.find((p) => p.id === projectId)?.workdir
  // Agents scope to the project workdir so project-scoped agents are assignable.
  const { agents: allAgents } = useAgents(workdir)
  const agents = allAgents.filter((a) => !a.subagent)
  const { data: commandsData } = useResource(commandsResource, workdir)
  const { data: workflowsData } = useResource(workflowsResource, workdir)

  // Agents, commands, and workflows all load via the resource cache
  // (implicit loadership) — no imperative fetch to remember here.

  const draftKey = `${DRAFT_KEY}:${projectId}:${initialTask?.id ?? 'new'}`

  const [prompt, setPrompt] = useState(() => initialTask?.prompt ?? '')
  const [attachments, setAttachments] = useState<Attachment[]>(() => initialTask?.attachments ?? [])
  const [agentId, setAgentId] = useState<string | undefined>(() => initialTask?.agentId ?? undefined)
  const [providerId, setProviderId] = useState<string | undefined>(() => initialTask?.providerId)
  const [model, setModel] = useState<string | undefined>(() => initialTask?.model)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [activeSlashParams, setActiveSlashParams] = useState<string[]>([])
  // --- Schedule state ---
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(() =>
    initialTask?.schedule ? (initialTask.schedule.type === 'once' ? 'once' : 'recurring') : 'none',
  )
  const [onceRunAt, setOnceRunAt] = useState(() =>
    toLocalInput(initialTask?.schedule?.type === 'once' ? initialTask.schedule.runAt : ''),
  )
  const [recurFreq, setRecurFreq] = useState<RecurFreq>(() =>
    initialTask?.schedule?.type === 'recurring' ? initialTask.schedule.freq : 'day',
  )
  const [recurInterval, setRecurInterval] = useState(() =>
    initialTask?.schedule?.type === 'recurring' ? initialTask.schedule.interval : 1,
  )
  const [recurWeekdays, setRecurWeekdays] = useState<number[]>(() =>
    initialTask?.schedule?.type === 'recurring' && initialTask.schedule.freq === 'week'
      ? (initialTask.schedule.weekdays ?? [])
      : [],
  )
  const [recurMonthDay, setRecurMonthDay] = useState(() =>
    initialTask?.schedule?.type === 'recurring' &&
    (initialTask.schedule.freq === 'month' || initialTask.schedule.freq === 'year')
      ? (initialTask.schedule.monthDay ?? 1)
      : 1,
  )
  const [recurYearMonth, setRecurYearMonth] = useState(() =>
    initialTask?.schedule?.type === 'recurring' && initialTask.schedule.freq === 'year'
      ? (initialTask.schedule.yearMonth ?? 1)
      : 1,
  )
  const [recurStartAt, setRecurStartAt] = useState(() =>
    toLocalInput(initialTask?.schedule?.type === 'recurring' ? initialTask.schedule.startAt : ''),
  )
  const [recurEndKind, setRecurEndKind] = useState<RecurEndKind>(() =>
    initialTask?.schedule?.type === 'recurring' ? initialTask.schedule.end.kind : 'never',
  )
  const [recurUntil, setRecurUntil] = useState(() =>
    toLocalInput(
      initialTask?.schedule?.type === 'recurring' && initialTask.schedule.end.kind === 'until'
        ? initialTask.schedule.end.until
        : '',
    ),
  )
  const [recurCount, setRecurCount] = useState(() =>
    initialTask?.schedule?.type === 'recurring' && initialTask.schedule.end.kind === 'count'
      ? initialTask.schedule.end.count
      : 1,
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerWrapRef = useRef<HTMLDivElement>(null)
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
    projectResource
      .refresh(projectId)
      .then((project) => {
        if (!cancelled && project?.workdir) {
          useProjectStore.getState().setCurrentProjectId(project.id)
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

  // Auto-resize the prompt textarea to fit its content: grow unboundedly, and
  // shrink back when the text is edited down. Skipping the scrollHeight read on
  // an empty prompt avoids the wrapped-placeholder inflation seen in narrow
  // layouts — the CSS min-height governs the empty state instead.
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    if (prompt) {
      textarea.style.height = `${textarea.scrollHeight + TEXTAREA_RESIZE_PAD}px`
    }
  }, [prompt])

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
      setActiveSlashParams(resolveSlashParamIds(suggestion, workdir))
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

  /** Rebuild the TaskSchedule from the current schedule-form state (undefined = off). */
  const buildScheduleFromState = (): TaskSchedule | undefined => {
    if (scheduleMode === 'once') return { type: 'once', runAt: fromLocalInput(onceRunAt) }
    if (scheduleMode === 'recurring') {
      return {
        type: 'recurring',
        freq: recurFreq,
        interval: recurInterval,
        ...(recurFreq === 'week' ? { weekdays: recurWeekdays } : {}),
        ...(recurFreq === 'month' || recurFreq === 'year' ? { monthDay: recurMonthDay } : {}),
        ...(recurFreq === 'year' ? { yearMonth: recurYearMonth } : {}),
        startAt: fromLocalInput(recurStartAt),
        end:
          recurEndKind === 'never'
            ? { kind: 'never' }
            : recurEndKind === 'until'
              ? { kind: 'until', until: fromLocalInput(recurUntil) }
              : { kind: 'count', count: recurCount },
        occurrencesDone: 0,
        nextRunAt: fromLocalInput(recurStartAt),
      }
    }
    return undefined
  }

  const save = async () => {
    const hasText = prompt.trim().length > 0
    const hasAttachments = attachments.length > 0
    if (!hasText && !hasAttachments) {
      setErrorMessage(t({ en: 'Add a prompt or an attachment', fr: 'Ajoutez une invite ou une pièce jointe' }))
      return
    }
    if (scheduleMode === 'once' && !onceRunAt) {
      setErrorMessage(t({ en: 'Choose a run time for the schedule', fr: 'Choisissez une heure d’exécution' }))
      return
    }
    if (scheduleMode === 'recurring') {
      if (!recurStartAt) {
        setErrorMessage(
          t({ en: 'Choose a first run date and time', fr: 'Choisissez une date et heure de première exécution' }),
        )
        return
      }
      if (recurFreq === 'week' && recurWeekdays.length === 0) {
        setErrorMessage(
          t({ en: 'Pick at least one weekday for the recurrence', fr: 'Sélectionnez au moins un jour de la semaine' }),
        )
        return
      }
      if (recurEndKind === 'until' && !recurUntil) {
        setErrorMessage(
          t({ en: 'Choose an end date for the recurrence', fr: 'Choisissez une date de fin de récurrence' }),
        )
        return
      }
    }
    setSaving(true)
    setErrorMessage(null)
    const schedule = buildScheduleFromState()
    const scheduleUnchanged =
      isEdit &&
      !!initialTask?.schedule &&
      !!schedule &&
      JSON.stringify(scheduleSignature(schedule)) === JSON.stringify(scheduleSignature(initialTask.schedule))
    const input: {
      prompt: string
      attachments?: Attachment[]
      agentId?: string | null
      providerId?: string | null
      model?: string | null
      schedule?: TaskSchedule | null
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
      // Edits only touch the schedule when the user changed it (omitting it
      // preserves the live nextRunAt/occurrence count); null clears it.
      // Creates only attach a schedule when one was configured.
      ...(scheduleUnchanged ? {} : isEdit ? { schedule: schedule ?? null } : schedule ? { schedule } : {}),
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
      setErrorMessage(lastError ?? t({ en: 'Could not save the task', fr: 'Impossible d’enregistrer la tâche' }))
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
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void save()
    }
  }

  const workflows = workflowsData ? selectAllWorkflows(workflowsData) : []
  const commands = commandsData
    ? dedupById(dedupById(commandsData.defaults, commandsData.userItems), commandsData.projectItems)
    : []

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
      title={isEdit ? t({ en: 'Edit task', fr: 'Modifier la tâche' }) : t({ en: 'New task', fr: 'Nouvelle tâche' })}
      size="lg"
      showCloseButton
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-text-muted truncate">
            {isAlreadyRunning
              ? t({
                  en: 'This task is already in progress — changes apply to the next run.',
                  fr: 'Cette tâche est déjà en cours — les modifications s’appliqueront à la prochaine exécution.',
                })
              : t({
                  en: 'Ctrl/Cmd+Enter to save · Enter for a new line',
                  fr: 'Ctrl/Cmd+Entrée pour enregistrer · Entrée pour une nouvelle ligne',
                })}
          </span>
          <SaveCancelButtons
            onCancel={onClose}
            onSave={() => void save()}
            saving={saving}
            saveLabel={
              isEdit
                ? t({ en: 'Save changes', fr: 'Enregistrer les modifications' })
                : t({ en: 'Create task', fr: 'Créer la tâche' })
            }
          />
        </div>
      }
    >
      {isAlreadyRunning && (
        <div className="mb-3 px-3 py-2 rounded bg-accent-primary/10 border border-accent-primary/30 text-sm text-text-primary">
          {t({
            en: 'This task is already in progress — changes apply to the next run.',
            fr: 'Cette tâche est déjà en cours — les modifications s’appliqueront à la prochaine exécution.',
          })}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-text-muted mb-1">{t({ en: 'Prompt', fr: 'Invite' })}</label>
          <div className="relative" ref={composerWrapRef} onDragOver={onDragOver} onDrop={onDrop}>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => {
                cursorPosRef.current = e.target.selectionStart
                handlePromptChange(e.target.value)
              }}
              onSelect={(e) => {
                cursorPosRef.current = e.currentTarget.selectionStart
              }}
              onPaste={onPaste}
              onKeyDown={onKeyDown}
              rows={6}
              spellCheck={false}
              placeholder={t({
                en: 'Describe the task. Slash commands (/cmd) and workflows resolve exactly as in chat when the task launches.',
                fr: 'Décrivez la tâche. Les commandes slash (/cmd) et les workflows se résolvent exactement comme dans le chat au lancement de la tâche.',
              })}
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary resize-y min-h-32"
            />
            <AtMentionAutocomplete
              ref={autocompleteRef}
              text={prompt}
              cursorPos={cursorPosRef.current}
              workdir={workdir}
              anchorRef={composerWrapRef}
              onSelect={handleSelectFile}
            />
            <SlashAutocomplete
              ref={slashAutocompleteRef}
              text={prompt}
              cursorPos={cursorPosRef.current}
              workflows={workflows}
              commands={commands}
              anchorRef={composerWrapRef}
              onSelect={handleSelectSlash}
            />
            {activeSlashParams.length > 0 && slashParamCount > 0 && (
              <div className="absolute top-2 right-14 text-xs text-text-muted bg-bg-secondary/90 border border-border rounded px-2 py-1">
                {t(
                  {
                    en: {
                      one: '{{count}} required param — tab through after the command',
                      other: '{{count}} required params — tab through after the command',
                    },
                    fr: {
                      one: '{{count}} paramètre requis — utilisez la tabulation après la commande',
                      other: '{{count}} paramètres requis — utilisez la tabulation après la commande',
                    },
                  },
                  { count: slashParamCount },
                )}
              </div>
            )}
            <div className="absolute bottom-2 right-2 flex items-center gap-1">
              <button
                type="button"
                onClick={undoPrompt}
                disabled={!canUndo}
                className="p-1.5 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                title={t({ en: 'Undo (Ctrl+Z)', fr: 'Annuler (Ctrl+Z)' })}
              >
                ↩︎
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-colors"
                title={t({ en: 'Attach files', fr: 'Joindre des fichiers' })}
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
            <label className="block text-sm font-medium text-text-muted mb-1">{t({ en: 'Agent', fr: 'Agent' })}</label>
            <select
              value={agentId ?? ''}
              onChange={(e) => setAgentId(e.target.value || undefined)}
              className="w-full px-3 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary"
            >
              <option value="">{t({ en: 'Default agent', fr: 'Agent par défaut' })}</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">{t({ en: 'Model', fr: 'Modèle' })}</label>
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

        <div className="border border-border rounded p-3 space-y-3">
          <div>
            <span className="block text-sm font-medium text-text-muted mb-1">
              {t({ en: 'Schedule', fr: 'Planification' })}
            </span>
            <div className="flex gap-1">
              {(
                [
                  { value: 'none', en: 'No schedule', fr: 'Aucune planification' },
                  { value: 'once', en: 'Run once', fr: 'Exécuter une fois' },
                  { value: 'recurring', en: 'Repeat', fr: 'Répéter' },
                ] as { value: ScheduleMode; en: string; fr: string }[]
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setScheduleMode(opt.value)
                    if (opt.value === 'recurring' && !recurStartAt) {
                      // Default the first run to the next full hour and derive
                      // the repeat-on selector from it.
                      const d = new Date(Date.now() + 60 * 60 * 1000)
                      d.setMinutes(0, 0, 0)
                      setRecurStartAt(toLocalInput(d.toISOString()))
                      setRecurWeekdays([d.getDay()])
                      setRecurMonthDay(d.getDate())
                      setRecurYearMonth(d.getMonth() + 1)
                    }
                  }}
                  aria-pressed={scheduleMode === opt.value}
                  className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                    scheduleMode === opt.value
                      ? 'bg-accent-primary/15 border-accent-primary/40 text-accent-primary'
                      : 'bg-bg-tertiary border-border text-text-muted hover:text-text-primary'
                  }`}
                >
                  {t(opt)}
                </button>
              ))}
            </div>
          </div>

          {scheduleMode === 'once' && (
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">
                {t({ en: 'Run at', fr: 'Exécuter à' })}
                <input
                  type="datetime-local"
                  value={onceRunAt}
                  onChange={(e) => setOnceRunAt(e.target.value)}
                  className="mt-1 w-full px-3 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary"
                />
              </label>
            </div>
          )}

          {scheduleMode === 'recurring' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">
                    {t({ en: 'First run (date & time)', fr: 'Première exécution (date et heure)' })}
                    <input
                      type="datetime-local"
                      value={recurStartAt}
                      onChange={(e) => setRecurStartAt(e.target.value)}
                      className="mt-1 w-full px-3 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary"
                    />
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">
                    {t({ en: 'Repeat every', fr: 'Répéter tous les' })}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={recurInterval}
                      onChange={(e) => setRecurInterval(Math.max(1, Number(e.target.value) || 1))}
                      aria-label={t({ en: 'Interval', fr: 'Intervalle' })}
                      className="w-20 px-3 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary"
                    />
                    <select
                      value={recurFreq}
                      onChange={(e) => setRecurFreq(e.target.value as RecurFreq)}
                      aria-label={t({ en: 'Repeat unit', fr: 'Unité de répétition' })}
                      className="flex-1 px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary"
                    >
                      {FREQ_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t(opt)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {recurFreq !== 'day' && (
                <div>
                  <span className="block text-sm font-medium text-text-muted mb-1">
                    {t({ en: 'Repeat on', fr: 'Répéter le' })}
                  </span>
                  {recurFreq === 'week' && (
                    <div className="flex gap-1 flex-wrap">
                      {WEEKDAY_ORDER.map((wd) => {
                        const selected = recurWeekdays.includes(wd)
                        return (
                          <button
                            key={wd}
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              setRecurWeekdays((prev) =>
                                selected ? prev.filter((d) => d !== wd) : [...prev, wd].sort(),
                              )
                            }
                            className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                              selected
                                ? 'bg-accent-primary/15 border-accent-primary/40 text-accent-primary'
                                : 'bg-bg-tertiary border-border text-text-muted hover:text-text-primary'
                            }`}
                          >
                            {weekdayLabel(wd)}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {recurFreq === 'month' && (
                    <DayOfMonthInput
                      value={recurMonthDay}
                      onChange={setRecurMonthDay}
                      ariaLabel={t({ en: 'Day of month', fr: 'Jour du mois' })}
                    />
                  )}
                  {recurFreq === 'year' && (
                    <div className="flex gap-2 items-center">
                      <select
                        value={recurYearMonth}
                        onChange={(e) => setRecurYearMonth(Number(e.target.value))}
                        aria-label={t({ en: 'Month', fr: 'Mois' })}
                        className="flex-1 px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary"
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                          <option key={m} value={m}>
                            {monthLabel(m)}
                          </option>
                        ))}
                      </select>
                      <DayOfMonthInput
                        value={recurMonthDay}
                        onChange={setRecurMonthDay}
                        ariaLabel={t({ en: 'Day of month', fr: 'Jour du mois' })}
                      />
                    </div>
                  )}
                </div>
              )}

              <div>
                <span className="block text-sm font-medium text-text-muted mb-1">
                  {t({ en: 'Ends', fr: 'Se termine' })}
                </span>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                    <input
                      type="radio"
                      name="task-recur-end"
                      checked={recurEndKind === 'never'}
                      onChange={() => setRecurEndKind('never')}
                      className="accent-accent-primary"
                    />
                    {t({ en: 'Never', fr: 'Jamais' })}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                    <input
                      type="radio"
                      name="task-recur-end"
                      checked={recurEndKind === 'until'}
                      onChange={() => setRecurEndKind('until')}
                      className="accent-accent-primary"
                    />
                    {t({ en: 'On date', fr: 'À une date' })}
                  </label>
                  {recurEndKind === 'until' && (
                    <input
                      type="datetime-local"
                      value={recurUntil}
                      onChange={(e) => setRecurUntil(e.target.value)}
                      aria-label={t({ en: 'End date', fr: 'Date de fin' })}
                      className="w-full px-3 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary"
                    />
                  )}
                  <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                    <input
                      type="radio"
                      name="task-recur-end"
                      checked={recurEndKind === 'count'}
                      onChange={() => setRecurEndKind('count')}
                      className="accent-accent-primary"
                    />
                    {t({ en: 'After N occurrences', fr: 'Après N occurrences' })}
                  </label>
                  {recurEndKind === 'count' && (
                    <input
                      type="number"
                      min={1}
                      value={recurCount}
                      onChange={(e) => setRecurCount(Math.max(1, Number(e.target.value) || 1))}
                      aria-label={t({ en: 'Occurrences', fr: 'Occurrences' })}
                      className="w-24 px-3 py-1.5 bg-bg-tertiary border border-border rounded text-sm text-text-primary outline-none focus:border-accent-primary"
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {errorMessage && <div className="text-sm text-accent-error">{errorMessage}</div>}
      </div>
    </Modal>
  )
}
