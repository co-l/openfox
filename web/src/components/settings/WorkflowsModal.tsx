import { useEffect, useState, useCallback, useMemo } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { Button } from '../shared/Button'
import { EditButton } from '../shared/IconButton'
import { useWorkflowsStore, type WorkflowFull, type WorkflowStep, type WorkflowCondition } from '../../stores/workflows'
import { useAgentsStore } from '../../stores/agents'
import { ArrowRightIcon, EyeIcon } from '../shared/icons'
import { ConfirmButton, DeleteIcon, DuplicateIcon, useConfirmDialog, CRUDListHeader } from './CRUDModal'
import { FlowDiagram } from './workflows/FlowDiagram'
import { WorkflowListSection } from './workflows/WorkflowListItem'
import { StepPanel } from './workflows/StepPanel'
import { TransitionPanel } from './workflows/TransitionPanel'
import { CONDITION_LABELS, CONDITION_TYPES, resolveAgent } from './workflows/layout'

interface WorkflowsModalProps {
  isOpen: boolean
  onClose: () => void
  initialEditId?: string | null
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function generateStepId(steps: WorkflowStep[]): string {
  let i = 1
  while (steps.some((s) => s.id === `s${i}`)) i++
  return `s${i}`
}

const inputClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const selectClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const labelClass = 'block text-[11px] text-text-secondary mb-0.5'

const DEFAULT_STEPS: WorkflowStep[] = []

export function WorkflowsModal({ isOpen, onClose, initialEditId }: WorkflowsModalProps) {
  const defaults = useWorkflowsStore((state) => state.defaults)
  const userItems = useWorkflowsStore((state) => state.userItems)
  const loading = useWorkflowsStore((state) => state.loading)
  const templateVariables = useWorkflowsStore((state) => state.templateVariables)
  const fetchWorkflows = useWorkflowsStore((state) => state.fetchWorkflows)
  const fetchWorkflow = useWorkflowsStore((state) => state.fetchWorkflow)
  const fetchDefaultContent = useWorkflowsStore((state) => state.fetchDefaultContent)
  const fetchTemplateVariables = useWorkflowsStore((state) => state.fetchTemplateVariables)
  const createWorkflow = useWorkflowsStore((state) => state.createWorkflow)
  const updateWorkflow = useWorkflowsStore((state) => state.updateWorkflow)
  const deleteWorkflowAction = useWorkflowsStore((state) => state.deleteWorkflow)

  const { requestDelete, clearConfirm, isConfirming } = useConfirmDialog()

  const [view, setView] = useState<'list' | 'edit'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isReadOnly, setIsReadOnly] = useState(false)
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null)
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null)

  const [formName, setFormName] = useState('')
  const [formId, setFormId] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formVersion, setFormVersion] = useState('1.0.0')
  const [formColor, setFormColor] = useState('#3b82f6')
  const [formEntryStep, setFormEntryStep] = useState('')
  const [formMaxIterations, setFormMaxIterations] = useState(50)

  const [formSteps, setFormSteps] = useState<WorkflowStep[]>(DEFAULT_STEPS)
  const [formStartCondition, setFormStartCondition] = useState<WorkflowCondition>({ type: 'always' })
  const [formError, setFormError] = useState('')
  const [_saving, setSaving] = useState(false)
  const agentDefaults = useAgentsStore((s) => s.defaults)
  const agentUserItems = useAgentsStore((s) => s.userItems)
  const agentProjectItems = useAgentsStore((s) => s.projectItems)
  const agentTypes = useMemo(
    () => [...agentDefaults, ...agentUserItems, ...agentProjectItems],
    [agentDefaults, agentUserItems, agentProjectItems],
  )
  const fetchAgents = useAgentsStore((s) => s.fetchAgents)

  const [_confirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      fetchWorkflows()
      fetchTemplateVariables()
      fetchAgents()
      setSelectedNodeKey(null)
      setSelectedEdgeKey(null)
      if (initialEditId) {
        const isDefault = defaults.some((d) => d.id === initialEditId)
        if (isDefault) {
          fetchDefaultContent(initialEditId).then((workflow) => {
            if (!workflow) return
            populateForm(
              {
                ...workflow,
                metadata: {
                  ...workflow.metadata,
                  name: workflow.metadata.name + ' (copy)',
                  id: `${initialEditId}-copy-${Date.now()}`,
                },
              },
              { editingId: null, isReadOnly: false },
            )
          })
        } else {
          fetchWorkflow(initialEditId).then((workflow) => {
            if (!workflow) return
            populateForm(workflow, { editingId: initialEditId, isReadOnly: false })
          })
        }
      } else {
        setView('list')
        setEditingId(null)
        setIsReadOnly(false)
      }
    }
  }, [isOpen, fetchWorkflows, fetchWorkflow, fetchDefaultContent, fetchTemplateVariables, initialEditId])

  const populateForm = (
    workflow: {
      metadata: { name: string; id: string; description: string; version: string; color?: string }
      entryStep: string
      settings: { maxIterations: number }
      steps: import('../../stores/workflows').WorkflowStep[]
      startCondition?: WorkflowCondition
    },
    extra?: Partial<{ editingId: string | null; isReadOnly: boolean; selectedNodeKey: null; selectedEdgeKey: null }>,
  ) => {
    setFormName(workflow.metadata.name)
    setFormId(workflow.metadata.id)
    setFormDescription(workflow.metadata.description)
    setFormVersion(workflow.metadata.version)
    setFormColor(workflow.metadata.color ?? '#3b82f6')
    setFormEntryStep(workflow.entryStep)
    setFormMaxIterations(workflow.settings.maxIterations)
    setFormSteps(workflow.steps)
    setFormStartCondition(workflow.startCondition ?? { type: 'always' })
    setFormError('')
    if (extra?.editingId !== undefined) setEditingId(extra.editingId)
    if (extra?.isReadOnly !== undefined) setIsReadOnly(extra.isReadOnly)
    if (extra?.selectedNodeKey !== undefined) setSelectedNodeKey(null)
    if (extra?.selectedEdgeKey !== undefined) setSelectedEdgeKey(null)
    setView('edit')
  }

  const handleEdit = async (workflowId: string) => {
    const workflow = await fetchWorkflow(workflowId)
    if (!workflow) return
    populateForm(workflow, { editingId: workflowId, isReadOnly: false, selectedNodeKey: null, selectedEdgeKey: null })
  }

  const doSave = async () => {
    const id = editingId ?? formId
    if (!id || !formName) {
      setFormError('Name is required.')
      return false
    }
    if (formSteps.length === 0) {
      setFormError('Add at least one step.')
      return false
    }
    let entry = formEntryStep
    if (!entry || !formSteps.some((s) => s.id === entry)) {
      entry = formSteps.find((s) => s.id)?.id ?? ''
      if (!entry) {
        setFormError('All steps need an ID.')
        return false
      }
      setFormEntryStep(entry)
    }
    setSaving(true)
    setFormError('')
    const workflow: WorkflowFull = {
      metadata: { id, name: formName, description: formDescription, version: formVersion || '1.0.0', color: formColor },
      entryStep: entry,
      settings: { maxIterations: formMaxIterations },
      steps: formSteps,
      startCondition: formStartCondition,
    }
    const result = editingId ? await updateWorkflow(editingId, workflow) : await createWorkflow(workflow)
    setSaving(false)
    if (!result.success) {
      setFormError(result.error ?? 'Failed to save.')
      return false
    }
    if (!editingId) setEditingId(id)
    return true
  }

  const handleSave = async () => {
    await doSave()
  }
  const handleSaveAndClose = async () => {
    if (await doSave()) {
      if (initialEditId) onClose()
      else setView('list')
    }
  }

  const handleCancelEdit = () => {
    if (initialEditId) {
      onClose()
    } else {
      setView('list')
    }
  }

  const handleNameChange = (name: string) => {
    setFormName(name)
    if (!editingId) setFormId(toSlug(name))
  }

  const fetchWorkflowContent = async (workflowId: string) => {
    const isDefault = defaults.some((d) => d.id === workflowId)
    return isDefault ? await fetchDefaultContent(workflowId) : await fetchWorkflow(workflowId)
  }

  const handleView = async (workflowId: string) => {
    const content = await fetchWorkflowContent(workflowId)
    if (!content) return
    populateForm(content, { editingId: workflowId, isReadOnly: true })
  }

  const handleDuplicate = async (workflowId: string) => {
    const content = await fetchWorkflowContent(workflowId)
    if (!content) return
    populateForm(
      {
        ...content,
        metadata: {
          ...content.metadata,
          name: content.metadata.name + ' (copy)',
          id: `${workflowId}-copy-${Date.now()}`,
        },
      },
      { editingId: null, isReadOnly: false },
    )
  }

  const handleNew = () => {
    setEditingId(null)
    setFormName('')
    setFormId('')
    setFormDescription('')
    setFormVersion('1.0.0')
    setFormColor('#3b82f6')
    setFormEntryStep('')
    setFormMaxIterations(50)
    setFormSteps(structuredClone(DEFAULT_STEPS))
    setFormStartCondition({ type: 'always' })
    setFormError('')
    setSelectedNodeKey(null)
    setSelectedEdgeKey(null)
    setIsReadOnly(false)
    setView('edit')
  }

  const handleDelete = async (workflowId: string) => {
    await deleteWorkflowAction(workflowId)
    clearConfirm()
  }

  const selectNode = useCallback((key: string | null) => {
    setSelectedNodeKey(key)
    setSelectedEdgeKey(null)
  }, [])
  const selectEdge = useCallback((key: string | null) => {
    setSelectedEdgeKey(key)
    setSelectedNodeKey(null)
  }, [])

  const selectedStepIndex = selectedNodeKey !== null ? Number(selectedNodeKey) : -1
  const selectedStep = selectedStepIndex >= 0 ? (formSteps[selectedStepIndex] ?? null) : null

  const updateStep = useCallback(
    (updated: WorkflowStep) => {
      setFormSteps((prev) => prev.map((s, i) => (i === selectedStepIndex ? updated : s)))
    },
    [selectedStepIndex],
  )

  const startConditionLabel =
    formStartCondition.type === 'step_result'
      ? `${formStartCondition.result}`
      : formStartCondition.type === 'metadata_all_match'
        ? `${formStartCondition.key ?? '?'}=${formStartCondition.value ?? '?'}`
        : formStartCondition.type === 'metadata_all_in'
          ? `${formStartCondition.key ?? '?'} in [${formStartCondition.values?.join(',') ?? '?'}]`
          : (CONDITION_LABELS[formStartCondition.type] ?? formStartCondition.type)

  const addStep = () => {
    const newIndex = formSteps.length
    const id = generateStepId(formSteps)
    const defaultAgent = agentTypes.find((a) => !a.subagent)
    setFormSteps([
      ...formSteps,
      {
        id,
        name: defaultAgent?.name ?? 'Agent',
        type: 'agent',
        phase: 'build',
        toolMode: (defaultAgent?.id ?? 'builder') as 'builder' | 'planner',
        transitions: [],
      },
    ])
    if (!formEntryStep) setFormEntryStep(id)
    selectNode(String(newIndex))
  }

  const handleCreateTransition = useCallback(
    (fromNodeId: string, toNodeId: string) => {
      if (fromNodeId === '$start') {
        setFormEntryStep(toNodeId)
        selectEdge('start')
      } else {
        setFormSteps((prev) => {
          const step = prev.find((s) => s.id === fromNodeId)
          const newTransIdx = step ? step.transitions.length : 0
          selectEdge(`${fromNodeId}:${newTransIdx}`)
          return prev.map((s) =>
            s.id === fromNodeId
              ? { ...s, transitions: [...s.transitions, { when: { type: 'always' }, goto: toNodeId }] }
              : s,
          )
        })
      }
    },
    [selectEdge],
  )

  const parseEdgeKey = (edgeKey: string): { stepId: string; transIdx: number } | null => {
    if (edgeKey === 'start') return null
    const sepIdx = edgeKey.lastIndexOf(':')
    const stepId = edgeKey.slice(0, sepIdx)
    const transIdx = parseInt(edgeKey.slice(sepIdx + 1))
    return { stepId, transIdx }
  }

  const updateTransition = useCallback(
    (
      edgeKey: string,
      updater: (t: { when: WorkflowCondition; goto: string }) => {
        when: WorkflowCondition
        goto: string
      },
    ) => {
      const parsed = parseEdgeKey(edgeKey)
      if (!parsed) return
      setFormSteps((prev) =>
        prev.map((s) =>
          s.id === parsed.stepId
            ? { ...s, transitions: s.transitions.map((t, i) => (i === parsed.transIdx ? updater(t) : t)) }
            : s,
        ),
      )
    },
    [],
  )

  const handleReconnectTo = useCallback(
    (edgeKey: string, newTarget: string) => {
      if (edgeKey === 'start') {
        setFormEntryStep(newTarget)
        return
      }
      updateTransition(edgeKey, (t) => ({ ...t, goto: newTarget }))
    },
    [updateTransition],
  )

  const handleReconnectFrom = useCallback((edgeKey: string, newSourceId: string) => {
    const parsed = parseEdgeKey(edgeKey)
    if (!parsed) return
    setFormSteps((prev) => {
      const oldStep = prev.find((s) => s.id === parsed.stepId)
      if (!oldStep) return prev
      const trans = oldStep.transitions[parsed.transIdx]
      if (!trans) return prev
      return prev.map((s) => {
        if (s.id === parsed.stepId) return { ...s, transitions: s.transitions.filter((_, i) => i !== parsed.transIdx) }
        if (s.id === newSourceId) return { ...s, transitions: [...s.transitions, trans] }
        return s
      })
    })
    setSelectedEdgeKey(null)
  }, [])

  const handleDeleteTransition = useCallback((edgeKey: string) => {
    if (edgeKey === 'start') {
      setFormEntryStep('')
      setSelectedEdgeKey(null)
      return
    }
    const parsed = parseEdgeKey(edgeKey)
    if (!parsed) return
    setFormSteps((prev) =>
      prev.map((s) =>
        s.id === parsed.stepId ? { ...s, transitions: s.transitions.filter((_, i) => i !== parsed.transIdx) } : s,
      ),
    )
    setSelectedEdgeKey(null)
  }, [])

  const handleUpdateTransitionCondition = useCallback(
    (edgeKey: string, when: WorkflowCondition) => {
      if (edgeKey === 'start') {
        setFormStartCondition(when)
        return
      }
      updateTransition(edgeKey, (t) => ({ ...t, when }))
    },
    [updateTransition],
  )

  const resolveStepLabel = (step: WorkflowStep) => resolveAgent(step, agentTypes).name

  const getSelectedEdgeInfo = () => {
    if (!selectedEdgeKey) return null
    if (selectedEdgeKey === 'start') {
      const entryStepObj = formSteps.find((s) => s.id === formEntryStep)
      return {
        type: 'start' as const,
        fromLabel: 'Start',
        toLabel: entryStepObj ? resolveStepLabel(entryStepObj) : '(none)',
        condition: formStartCondition,
      }
    }
    const sepIdx = selectedEdgeKey.lastIndexOf(':')
    const stepId = selectedEdgeKey.slice(0, sepIdx)
    const transIdx = parseInt(selectedEdgeKey.slice(sepIdx + 1))
    const step = formSteps.find((s) => s.id === stepId)
    if (!step) return null
    const transition = step.transitions[transIdx]
    if (!transition) return null
    const toStep = formSteps.find((s) => s.id === transition.goto)
    const toLabel = transition.goto === '$done' ? 'Done' : toStep ? resolveStepLabel(toStep) : transition.goto
    return {
      type: 'step' as const,
      fromLabel: resolveStepLabel(step),
      toLabel,
      condition: transition.when,
    }
  }

  if (view === 'edit') {
    const edgeInfo = getSelectedEdgeInfo()

    return (
      <Modal
        isOpen={isOpen}
        onClose={handleCancelEdit}
        title={isReadOnly ? formName : editingId ? 'Edit Workflow' : 'New Workflow'}
        size="full"
      >
        {formError && (
          <div className="text-accent-error text-sm px-3 py-2 bg-accent-error/10 rounded mb-3">{formError}</div>
        )}

        <div className="flex items-end gap-3 mb-3 pb-3 border-b border-border flex-wrap">
          <div className="min-w-[140px]">
            <label className={labelClass}>Name</label>
            <input
              value={formName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Workflow name"
              className={`${inputClass} ${isReadOnly ? 'opacity-50' : ''}`}
              readOnly={isReadOnly}
            />
          </div>
          <div className="min-w-[100px]">
            <label className={labelClass}>ID</label>
            <input value={formId} readOnly className={`${inputClass} font-mono opacity-50`} />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className={labelClass}>Description</label>
            <input
              value={formDescription}
              onChange={(e) => !isReadOnly && setFormDescription(e.target.value)}
              readOnly={isReadOnly}
              placeholder="What does this workflow do?"
              className={`${inputClass} ${isReadOnly ? 'opacity-50' : ''}`}
            />
          </div>
          <div className="w-20">
            <label className={labelClass}>Max Iter.</label>
            <input
              type="number"
              value={formMaxIterations}
              onChange={(e) => !isReadOnly && setFormMaxIterations(Number(e.target.value))}
              readOnly={isReadOnly}
              className={`${inputClass} font-mono ${isReadOnly ? 'opacity-50' : ''}`}
            />
          </div>
          <div>
            <label className={labelClass}>Color</label>
            <input
              type="color"
              value={formColor}
              onChange={(e) => !isReadOnly && setFormColor(e.target.value)}
              disabled={isReadOnly}
              className={`w-8 h-8 rounded border border-border bg-transparent ${isReadOnly ? 'opacity-50' : 'cursor-pointer'}`}
            />
          </div>
        </div>

        <div className="flex gap-3" style={{ height: 'calc(90vh - 220px)', minHeight: 300 }}>
          <div className="flex-1 min-w-0 bg-bg-primary/50 border border-border rounded-lg flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 shrink-0">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-medium">Flow</span>
              {!isReadOnly && (
                <button onClick={addStep} className="text-[11px] text-accent-primary hover:text-accent-primary/80">
                  + Add Step
                </button>
              )}
            </div>
            <div className="flex-1 min-h-0 p-2 overflow-auto">
              <FlowDiagram
                steps={formSteps}
                entryStep={formEntryStep}
                selectedNodeId={selectedStep?.id ?? null}
                selectedEdgeKey={selectedEdgeKey}
                startConditionLabel={startConditionLabel}
                agentTypes={agentTypes}
                isReadOnly={isReadOnly}
                onSelectNode={(id) => {
                  if (id === null) {
                    selectNode(null)
                    return
                  }
                  const idx = formSteps.findIndex((s) => s.id === id)
                  selectNode(idx >= 0 ? String(idx) : null)
                }}
                onSelectEdge={selectEdge}
                onRemoveStep={(id) => {
                  const idx = formSteps.findIndex((s) => s.id === id)
                  setFormSteps((prev) => prev.filter((s) => s.id !== id))
                  if (selectedStepIndex === idx) selectNode(null)
                  if (formEntryStep === id) {
                    const remaining = formSteps.filter((s) => s.id !== id)
                    setFormEntryStep(remaining[0]?.id ?? '')
                  }
                }}
                onCreateTransition={handleCreateTransition}
                onReconnectTo={handleReconnectTo}
                onReconnectFrom={handleReconnectFrom}
                onDeleteTransition={handleDeleteTransition}
              />
              {formSteps.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-text-muted">
                  <p className="text-xs mb-2">No steps yet</p>
                  <button
                    onClick={addStep}
                    className="px-3 py-1.5 rounded bg-accent-primary/10 text-accent-primary text-xs hover:bg-accent-primary/20"
                  >
                    + Add your first step
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="w-[300px] shrink-0 border border-border rounded-lg bg-bg-secondary flex flex-col overflow-hidden">
            <div className="px-3 py-1.5 border-b border-border shrink-0">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-medium">Properties</span>
            </div>
            <div className="p-3 overflow-y-auto flex-1 min-h-0">
              {isReadOnly && (edgeInfo || selectedStep) ? (
                <p className="text-text-muted text-xs text-center py-8">
                  View only — click "Duplicate & Customize" to edit.
                </p>
              ) : edgeInfo ? (
                edgeInfo.type === 'start' ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-300">
                        Start
                      </span>
                    </div>
                    {formEntryStep && (
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <span className="text-text-primary font-medium">Start</span>
                        <ArrowRightIcon />
                        <span className="text-text-primary font-medium">{edgeInfo.toLabel}</span>
                      </div>
                    )}
                    <div>
                      <label className={labelClass}>Activation Condition</label>
                      <select
                        value={formStartCondition.type}
                        onChange={(e) =>
                          setFormStartCondition(
                            e.target.value === 'step_result'
                              ? { type: 'step_result', result: 'success' }
                              : e.target.value === 'metadata_all_match'
                                ? { type: 'metadata_all_match', key: '', field: '', value: '' }
                                : e.target.value === 'metadata_all_in'
                                  ? { type: 'metadata_all_in', key: '', field: '', values: [] }
                                  : { type: e.target.value },
                          )
                        }
                        className={selectClass}
                      >
                        {CONDITION_TYPES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {formStartCondition.type === 'step_result' && (
                      <div>
                        <label className={labelClass}>Result</label>
                        {formEntryStep &&
                          (() => {
                            const entryStep = formSteps.find((s) => s.id === formEntryStep)
                            const stepAgent =
                              entryStep && (entryStep.type === 'sub_agent' || entryStep.type === 'agent')
                                ? agentTypes.find(
                                    (a) =>
                                      a.id ===
                                      (entryStep.type === 'sub_agent' ? entryStep.subAgentType : entryStep.toolMode),
                                  )
                                : undefined
                            const hasResults = stepAgent?.results && stepAgent.results.length > 0
                            const results = stepAgent?.results ?? []
                            return hasResults ? (
                              <select
                                value={formStartCondition.result ?? results[0]}
                                onChange={(e) => setFormStartCondition({ type: 'step_result', result: e.target.value })}
                                className={selectClass}
                              >
                                {results.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={formStartCondition.result ?? 'success'}
                                onChange={(e) => setFormStartCondition({ type: 'step_result', result: e.target.value })}
                                placeholder="e.g. success, passed, failed"
                                className={inputClass}
                              />
                            )
                          })()}
                      </div>
                    )}

                    {(formStartCondition.type === 'metadata_all_match' ||
                      formStartCondition.type === 'metadata_all_in') && (
                      <>
                        <div>
                          <label className={labelClass}>Metadata Key</label>
                          <input
                            type="text"
                            value={formStartCondition.key ?? ''}
                            onChange={(e) => setFormStartCondition({ ...formStartCondition, key: e.target.value })}
                            placeholder="e.g. criteria, todos, review_findings"
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Field</label>
                          <input
                            type="text"
                            value={formStartCondition.field ?? ''}
                            onChange={(e) => setFormStartCondition({ ...formStartCondition, field: e.target.value })}
                            placeholder="e.g. status"
                            className={inputClass}
                          />
                        </div>
                        {formStartCondition.type === 'metadata_all_match' ? (
                          <div>
                            <label className={labelClass}>Value</label>
                            <input
                              type="text"
                              value={formStartCondition.value ?? ''}
                              onChange={(e) => setFormStartCondition({ ...formStartCondition, value: e.target.value })}
                              placeholder="e.g. passed, resolved"
                              className={inputClass}
                            />
                          </div>
                        ) : (
                          <div>
                            <label className={labelClass}>Values (comma-separated)</label>
                            <input
                              type="text"
                              value={formStartCondition.values?.join(', ') ?? ''}
                              onChange={(e) =>
                                setFormStartCondition({
                                  ...formStartCondition,
                                  values: e.target.value
                                    .split(',')
                                    .map((v) => v.trim())
                                    .filter(Boolean),
                                })
                              }
                              placeholder="e.g. resolved, dismissed"
                              className={inputClass}
                            />
                          </div>
                        )}
                      </>
                    )}
                    <p className="text-text-muted text-[10px]">
                      Workflow only proceeds when this condition is met. Drag the target handle to change entry step.
                    </p>
                  </div>
                ) : (
                  (() => {
                    const parsed = parseEdgeKey(selectedEdgeKey!)
                    const stepId = parsed?.stepId
                    const transIdx = parsed?.transIdx ?? 0
                    const step = stepId ? formSteps.find((s) => s.id === stepId) : undefined
                    const totalTransitions = step?.transitions.length ?? 0
                    return (
                      <TransitionPanel
                        fromLabel={edgeInfo.fromLabel}
                        toLabel={edgeInfo.toLabel}
                        condition={edgeInfo.condition}
                        fromStep={
                          edgeInfo.type === 'step' ? formSteps.find((s) => s.id === edgeInfo.fromLabel) : undefined
                        }
                        agentTypes={agentTypes}
                        transitionIndex={transIdx}
                        totalTransitions={totalTransitions}
                        onUpdateCondition={(when) => handleUpdateTransitionCondition(selectedEdgeKey!, when)}
                        onDelete={() => handleDeleteTransition(selectedEdgeKey!)}
                        onMoveUp={() => {
                          setFormSteps((prev) => {
                            const s = prev.find((s) => s.id === stepId)
                            if (!s || transIdx === 0) return prev
                            const transitions = [...s.transitions]
                            ;[transitions[transIdx - 1], transitions[transIdx]] = [
                              transitions[transIdx]!,
                              transitions[transIdx - 1]!,
                            ]
                            return prev.map((st) => (st.id === stepId ? { ...st, transitions } : st))
                          })
                          setSelectedEdgeKey(`${stepId}:${transIdx - 1}`)
                        }}
                        onMoveDown={() => {
                          setFormSteps((prev) => {
                            const s = prev.find((s) => s.id === stepId)
                            if (!s || transIdx === s.transitions.length - 1) return prev
                            const transitions = [...s.transitions]
                            ;[transitions[transIdx], transitions[transIdx + 1]] = [
                              transitions[transIdx + 1]!,
                              transitions[transIdx]!,
                            ]
                            return prev.map((st) => (st.id === stepId ? { ...st, transitions } : st))
                          })
                          setSelectedEdgeKey(`${stepId}:${transIdx + 1}`)
                        }}
                      />
                    )
                  })()
                )
              ) : selectedStep ? (
                <StepPanel
                  step={selectedStep}
                  isEntry={selectedStep.id === formEntryStep}
                  agentTypes={agentTypes}
                  transitionCount={selectedStep.transitions.length}
                  templateVariables={templateVariables}
                  onUpdate={updateStep}
                  onRemove={() => {
                    if (selectedStep) {
                      setFormSteps(formSteps.filter((_, i) => i !== selectedStepIndex))
                      selectNode(null)
                      if (formEntryStep === selectedStep.id) {
                        const remaining = formSteps.filter((_, i) => i !== selectedStepIndex)
                        setFormEntryStep(remaining[0]?.id ?? '')
                      }
                    }
                  }}
                  onSetEntry={() => setFormEntryStep(selectedStep.id)}
                />
              ) : (
                <p className="text-text-muted text-xs text-center py-8">
                  Click a node or edge to edit.
                  <br />
                  Drag from a port to connect.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-border">
          <Button variant="secondary" onClick={handleCancelEdit}>
            Close
          </Button>
          {isReadOnly ? (
            <Button
              variant="primary"
              onClick={() => {
                setFormName(formName + ' (copy)')
                setFormId(`${editingId}-copy-${Date.now()}`)
                setEditingId(null)
                setIsReadOnly(false)
              }}
            >
              Duplicate & Customize
            </Button>
          ) : (
            <>
              <Button variant="primary" onClick={handleSave}>
                Save
              </Button>
              <Button variant="primary" onClick={handleSaveAndClose}>
                Save & Close
              </Button>
            </>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Workflows" size="lg">
      <CRUDListHeader
        description="Workflows define multi-step agentic processes with branching transitions."
        onNew={handleNew}
        loading={loading}
        hasItems={defaults.length > 0 || userItems.length > 0}
      >
        <div className="space-y-4">
          <WorkflowListSection
            title="Built-in"
            items={defaults}
            renderActions={(wf) => (
              <>
                <EditButton onClick={() => handleView(wf.id)}>
                  <EyeIcon />
                </EditButton>
                <DuplicateIcon onClick={() => handleDuplicate(wf.id)} />
              </>
            )}
          />
          <WorkflowListSection
            title="Custom"
            items={userItems}
            renderActions={(wf) => (
              <>
                <EditButton onClick={() => handleView(wf.id)}>
                  <EyeIcon />
                </EditButton>
                <EditButton onClick={() => handleEdit(wf.id)}>
                  <span className="text-[10px]">Edit</span>
                </EditButton>
                <DuplicateIcon onClick={() => handleDuplicate(wf.id)} />
                {isConfirming(wf.id, 'delete') ? (
                  <ConfirmButton onConfirm={() => handleDelete(wf.id)} onCancel={clearConfirm} />
                ) : (
                  <DeleteIcon onClick={() => requestDelete(wf.id)} />
                )}
              </>
            )}
          />
        </div>
      </CRUDListHeader>
    </Modal>
  )
}
