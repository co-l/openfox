import { useEffect, useState, useMemo, useCallback } from 'react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { usePipelinesStore, type PipelineFull, type PipelineStep } from '../../stores/pipelines'

interface PipelinesModalProps {
  isOpen: boolean
  onClose: () => void
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ============================================================================
// Constants
// ============================================================================

const STEP_TYPES = [
  { value: 'llm_turn', label: 'LLM Turn' },
  { value: 'sub_agent', label: 'Sub-Agent' },
  { value: 'shell', label: 'Shell' },
] as const

const CONDITION_LABELS: Record<string, string> = {
  all_criteria_passed: 'All passed',
  all_criteria_completed_or_passed: 'All completed',
  any_criteria_blocked: 'Blocked',
  has_pending_criteria: 'Has pending',
  step_result: 'Result',
  always: 'Always',
}

const CONDITION_TYPES = [
  { value: 'all_criteria_passed', label: 'All criteria passed' },
  { value: 'all_criteria_completed_or_passed', label: 'All criteria completed or passed' },
  { value: 'any_criteria_blocked', label: 'Any criteria blocked (retry limit)' },
  { value: 'has_pending_criteria', label: 'Has pending criteria' },
  { value: 'step_result', label: 'Step result is...' },
  { value: 'always', label: 'Always (fallback)' },
] as const

const NODE_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  llm_turn: { bg: 'fill-blue-500/10', border: 'stroke-blue-500', text: 'text-blue-400', badge: 'bg-blue-500/20 text-blue-300' },
  sub_agent: { bg: 'fill-purple-500/10', border: 'stroke-purple-500', text: 'text-purple-400', badge: 'bg-purple-500/20 text-purple-300' },
  shell: { bg: 'fill-green-500/10', border: 'stroke-green-500', text: 'text-green-400', badge: 'bg-green-500/20 text-green-300' },
}

const NODE_W = 160
const NODE_H = 60
const TERM_W = 80
const TERM_H = 34
const GAP_X = 80
const GAP_Y = 100
const PAD = 50
const BACK_EDGE_MARGIN = 35 // space reserved on sides for back-edges

// ============================================================================
// Layout Algorithm
// ============================================================================

interface LayoutNode {
  id: string
  type: 'step' | 'terminal'
  stepType?: string
  label: string
  sublabel?: string
  cx: number  // center x
  cy: number  // center y
  w: number
  h: number
  isEntry: boolean
}

interface LayoutEdge {
  from: string
  to: string
  label: string
  direction: 'down' | 'back' | 'same'
  backEdgeIndex: number // for stacking multiple back-edges
}

function computeLayout(steps: PipelineStep[], entryStep: string) {
  if (steps.length === 0) return { nodes: [] as LayoutNode[], edges: [] as LayoutEdge[], width: 300, height: 100, posMap: new Map<string, { cx: number; cy: number; w: number; h: number }>() }

  // Collect terminal targets
  const stepIds = new Set(steps.map(s => s.id))
  const terminals = new Set<string>()
  for (const step of steps) {
    for (const t of step.transitions) {
      if (t.goto && !stepIds.has(t.goto)) terminals.add(t.goto)
    }
  }

  // BFS layers from entry
  const layers: string[][] = []
  const layerOf = new Map<string, number>()
  const queue = [entryStep]
  layerOf.set(entryStep, 0)

  while (queue.length > 0) {
    const id = queue.shift()!
    const layer = layerOf.get(id)!
    while (layers.length <= layer) layers.push([])
    layers[layer]!.push(id)

    const step = steps.find(s => s.id === id)
    if (!step) continue
    for (const t of step.transitions) {
      if (stepIds.has(t.goto) && !layerOf.has(t.goto)) {
        layerOf.set(t.goto, layer + 1)
        queue.push(t.goto)
      }
    }
  }

  // Add unvisited steps
  for (const step of steps) {
    if (!layerOf.has(step.id)) {
      const layer = layers.length
      layerOf.set(step.id, layer)
      while (layers.length <= layer) layers.push([])
      layers[layer]!.push(step.id)
    }
  }

  // Terminal layer
  if (terminals.size > 0) {
    const tLayer = layers.length
    layers.push([...terminals])
    for (const t of terminals) layerOf.set(t, tLayer)
  }

  // Position nodes
  const maxLayerCount = Math.max(...layers.map(l => l.length))
  const contentWidth = maxLayerCount * (NODE_W + GAP_X) - GAP_X
  const totalWidth = Math.max(contentWidth + PAD * 2 + BACK_EDGE_MARGIN * 2, 400)

  const nodes: LayoutNode[] = []
  const posMap = new Map<string, { cx: number; cy: number; w: number; h: number }>()

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li]!
    for (let ni = 0; ni < layer.length; ni++) {
      const id = layer[ni]!
      const isTerminal = terminals.has(id)
      const w = isTerminal ? TERM_W : NODE_W
      const h = isTerminal ? TERM_H : NODE_H
      const layerW = layer.length * (NODE_W + GAP_X) - GAP_X
      const offsetX = (totalWidth - layerW) / 2
      const cx = offsetX + ni * (NODE_W + GAP_X) + NODE_W / 2
      const cy = PAD + li * (NODE_H + GAP_Y) + NODE_H / 2

      posMap.set(id, { cx, cy, w, h })

      if (isTerminal) {
        nodes.push({ id, type: 'terminal', label: id === '$done' ? 'Done' : id === '$blocked' ? 'Blocked' : id, cx, cy, w, h, isEntry: false })
      } else {
        const step = steps.find(s => s.id === id)!
        nodes.push({ id, type: 'step', stepType: step.type, label: step.name || id, sublabel: STEP_TYPES.find(t => t.value === step.type)?.label, cx, cy, w, h, isEntry: id === entryStep })
      }
    }
  }

  // Edges with direction classification
  let backEdgeCounter = 0
  const edges: LayoutEdge[] = []
  for (const step of steps) {
    for (const t of step.transitions) {
      if (!posMap.has(t.goto)) continue
      const fromLayer = layerOf.get(step.id) ?? 0
      const toLayer = layerOf.get(t.goto) ?? 0
      const condLabel = t.when.type === 'step_result' ? `${t.when.result}` : (CONDITION_LABELS[t.when.type] ?? t.when.type)
      let direction: 'down' | 'back' | 'same'
      if (toLayer > fromLayer) direction = 'down'
      else if (toLayer < fromLayer) direction = 'back'
      else direction = 'same'
      edges.push({ from: step.id, to: t.goto, label: condLabel, direction, backEdgeIndex: direction === 'back' ? backEdgeCounter++ : 0 })
    }
  }

  const height = PAD * 2 + layers.length * (NODE_H + GAP_Y) - GAP_Y
  return { nodes, edges, width: totalWidth, height, posMap }
}

// ============================================================================
// SVG Flow Diagram
// ============================================================================

function FlowDiagram({
  steps,
  entryStep,
  selectedId,
  onSelect,
}: {
  steps: PipelineStep[]
  entryStep: string
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const { nodes, edges, width, height, posMap } = useMemo(
    () => computeLayout(steps, entryStep),
    [steps, entryStep]
  )

  // Build edge paths
  const renderEdge = (e: LayoutEdge, i: number) => {
    const from = posMap.get(e.from)
    const to = posMap.get(e.to)
    if (!from || !to) return null

    let path: string
    let labelX: number
    let labelY: number

    if (e.direction === 'down') {
      // Forward edge: exit bottom, enter top
      const x1 = from.cx
      const y1 = from.cy + from.h / 2
      const x2 = to.cx
      const y2 = to.cy - to.h / 2
      const dy = y2 - y1
      path = `M ${x1} ${y1} C ${x1} ${y1 + dy * 0.5}, ${x2} ${y2 - dy * 0.5}, ${x2} ${y2}`
      labelX = (x1 + x2) / 2
      labelY = (y1 + y2) / 2
    } else if (e.direction === 'back') {
      // Back edge: route around the right side
      const offset = BACK_EDGE_MARGIN + e.backEdgeIndex * 14
      const x1 = from.cx + from.w / 2
      const y1 = from.cy
      const x2 = to.cx + to.w / 2
      const y2 = to.cy
      const rightX = Math.max(x1, x2) + offset
      path = `M ${x1} ${y1} L ${rightX} ${y1} L ${rightX} ${y2} L ${x2} ${y2}`
      labelX = rightX + 4
      labelY = (y1 + y2) / 2
    } else {
      // Same level
      const x1 = from.cx
      const y1 = from.cy - from.h / 2
      const x2 = to.cx
      const y2 = to.cy - to.h / 2
      const bendY = Math.min(y1, y2) - 30
      path = `M ${x1} ${y1} L ${x1} ${bendY} L ${x2} ${bendY} L ${x2} ${y2}`
      labelX = (x1 + x2) / 2
      labelY = bendY - 4
    }

    return (
      <g key={i}>
        <path d={path} fill="none" className="stroke-text-muted/30" strokeWidth={1.5} markerEnd="url(#arrow)" />
        {/* Label */}
        <g>
          <rect
            x={labelX - 30}
            y={labelY - 8}
            width={60}
            height={15}
            rx={3}
            className="fill-bg-primary/90"
          />
          <text x={labelX} y={labelY + 3} textAnchor={e.direction === 'back' ? 'start' : 'middle'} className="fill-text-muted text-[9px]">
            {e.label}
          </text>
        </g>
      </g>
    )
  }

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      className="block"
      style={{ minHeight: Math.min(height, 500) }}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
          <polygon points="0 0, 10 3.5, 0 7" className="fill-text-muted/50" />
        </marker>
      </defs>

      {/* Edges (render before nodes so nodes are on top) */}
      {edges.map((e, i) => renderEdge(e, i))}

      {/* Nodes */}
      {nodes.map(node => {
        const isSelected = selectedId === node.id
        const colors = node.stepType ? NODE_COLORS[node.stepType] : null
        const x = node.cx - node.w / 2
        const y = node.cy - node.h / 2

        if (node.type === 'terminal') {
          const isDone = node.id === '$done'
          return (
            <g key={node.id}>
              <rect x={x} y={y} width={node.w} height={node.h} rx={node.h / 2}
                className={isDone ? 'fill-green-500/12 stroke-green-600/50' : 'fill-red-500/12 stroke-red-600/50'}
                strokeWidth={1.5} />
              <text x={node.cx} y={node.cy + 4} textAnchor="middle"
                className={`text-[11px] font-medium ${isDone ? 'fill-green-400' : 'fill-red-400'}`}>
                {node.label}
              </text>
            </g>
          )
        }

        return (
          <g key={node.id} onClick={() => onSelect(isSelected ? null : node.id)} className="cursor-pointer">
            {/* Selection glow */}
            {isSelected && (
              <rect x={x - 4} y={y - 4} width={node.w + 8} height={node.h + 8} rx={12}
                className="fill-none stroke-accent-primary/60" strokeWidth={2} />
            )}
            {/* Entry arrow */}
            {node.isEntry && (
              <polygon
                points={`${x - 18},${node.cy - 6} ${x - 18},${node.cy + 6} ${x - 6},${node.cy}`}
                className="fill-accent-primary"
              />
            )}
            {/* Body */}
            <rect x={x} y={y} width={node.w} height={node.h} rx={10}
              className={`${colors?.bg ?? 'fill-bg-tertiary'} ${colors?.border ?? 'stroke-border'}`}
              strokeWidth={isSelected ? 2 : 1.5} />
            {/* Name */}
            <text x={node.cx} y={node.cy - 3} textAnchor="middle" className="fill-text-primary text-[12px] font-medium">
              {node.label}
            </text>
            {/* Type */}
            {node.sublabel && (
              <text x={node.cx} y={node.cy + 14} textAnchor="middle" className={`text-[10px] ${colors?.text ?? 'fill-text-muted'}`}>
                {node.sublabel}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ============================================================================
// Step Properties Panel
// ============================================================================

const inputClass = 'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const selectClass = 'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const labelClass = 'block text-[11px] text-text-secondary mb-0.5'

interface SubAgentTypeInfo {
  id: string
  name: string
  description: string
}

function StepPanel({
  step,
  allStepIds,
  isEntry,
  subAgentTypes,
  onUpdate,
  onRemove,
  onSetEntry,
}: {
  step: PipelineStep
  allStepIds: string[]
  isEntry: boolean
  subAgentTypes: SubAgentTypeInfo[]
  onUpdate: (step: PipelineStep) => void
  onRemove: () => void
  onSetEntry: () => void
}) {
  const colors = NODE_COLORS[step.type]
  const update = <K extends keyof PipelineStep>(key: K, value: PipelineStep[K]) => {
    onUpdate({ ...step, [key]: value })
  }

  const gotoOptions = ['$done', '$blocked', ...allStepIds]

  return (
    <div className="space-y-3 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${colors?.badge ?? 'bg-bg-tertiary text-text-muted'}`}>
            {STEP_TYPES.find(t => t.value === step.type)?.label}
          </span>
          {isEntry && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent-primary/15 text-accent-primary">Entry</span>}
        </div>
        <div className="flex items-center gap-1">
          {!isEntry && (
            <button onClick={onSetEntry} className="p-1 rounded text-text-muted hover:text-accent-primary text-xs" title="Set as entry">
              Set entry
            </button>
          )}
          <button onClick={onRemove} className="p-1 rounded text-text-muted hover:text-accent-error text-xs" title="Delete step">
            Delete
          </button>
        </div>
      </div>

      {/* Core fields */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Name</label>
          <input value={step.name} onChange={e => update('name', e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>ID</label>
          <input value={step.id} onChange={e => update('id', toSlug(e.target.value))} className={`${inputClass} font-mono`} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Type</label>
          <select value={step.type} onChange={e => update('type', e.target.value as PipelineStep['type'])} className={selectClass}>
            {STEP_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Phase</label>
          <select value={step.phase} onChange={e => update('phase', e.target.value)} className={selectClass}>
            <option value="build">Build</option>
            <option value="verification">Verification</option>
          </select>
        </div>
      </div>

      {/* Type-specific */}
      {step.type === 'llm_turn' && (
        <>
          <div>
            <label className={labelClass}>Tool Mode</label>
            <select value={step.toolMode ?? 'builder'} onChange={e => update('toolMode', e.target.value as 'builder' | 'planner')} className={`${selectClass} w-32`}>
              <option value="builder">Builder</option>
              <option value="planner">Planner</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Kickoff Prompt</label>
            <textarea value={step.kickoffPrompt ?? ''} onChange={e => update('kickoffPrompt', e.target.value || undefined)} rows={2} className={`${inputClass} resize-none`} placeholder="Injected on first entry..." />
          </div>
          <div>
            <label className={labelClass}>Nudge Prompt</label>
            <textarea value={step.nudgePrompt ?? ''} onChange={e => update('nudgePrompt', e.target.value || undefined)} rows={2} className={`${inputClass} resize-none`} placeholder="Injected on re-entry. Supports {{reason}}, {{verifierFindings}}..." />
          </div>
        </>
      )}

      {step.type === 'sub_agent' && (
        <>
          <div>
            <label className={labelClass}>Sub-Agent Type</label>
            <select value={step.subAgentType ?? ''} onChange={e => update('subAgentType', e.target.value)} className={selectClass}>
              <option value="">— select —</option>
              {subAgentTypes.map(sa => <option key={sa.id} value={sa.id}>{sa.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>Prompt Override</label>
            <textarea value={step.prompt ?? ''} onChange={e => update('prompt', e.target.value || undefined)} rows={2} className={`${inputClass} resize-none`} placeholder="Optional override..." />
          </div>
        </>
      )}

      {step.type === 'shell' && (
        <>
          <div>
            <label className={labelClass}>Command</label>
            <input value={step.command ?? ''} onChange={e => update('command', e.target.value)} className={`${inputClass} font-mono`} placeholder="cd {{workdir}} && npm run lint" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Timeout (ms)</label>
              <input type="number" value={step.timeout ?? 60000} onChange={e => update('timeout', Number(e.target.value))} className={`${inputClass} font-mono`} />
            </div>
            <div>
              <label className={labelClass}>Success Codes</label>
              <input value={(step.successExitCodes ?? [0]).join(', ')} onChange={e => update('successExitCodes', e.target.value.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n)))} className={`${inputClass} font-mono`} />
            </div>
          </div>
        </>
      )}

      {/* Transitions */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={`${labelClass} mb-0 font-medium`}>Transitions</label>
          <button
            onClick={() => update('transitions', [...step.transitions, { when: { type: 'always' }, goto: '' }])}
            className="text-[11px] text-accent-primary hover:text-accent-primary/80"
          >
            + Add
          </button>
        </div>
        <div className="space-y-1">
          {step.transitions.map((t, ti) => (
            <div key={ti} className="flex items-center gap-1.5 bg-bg-tertiary rounded px-2 py-1">
              <select
                value={t.when.type}
                onChange={e => {
                  const newTransitions = [...step.transitions]
                  newTransitions[ti] = {
                    ...t,
                    when: e.target.value === 'step_result'
                      ? { type: 'step_result', result: 'success' }
                      : { type: e.target.value },
                  }
                  update('transitions', newTransitions)
                }}
                className="bg-transparent text-xs border-none focus:outline-none flex-1 min-w-0 text-text-primary"
              >
                {CONDITION_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              {t.when.type === 'step_result' && (
                <select
                  value={t.when.result ?? 'success'}
                  onChange={e => {
                    const newTransitions = [...step.transitions]
                    newTransitions[ti] = { ...t, when: { type: 'step_result', result: e.target.value } }
                    update('transitions', newTransitions)
                  }}
                  className="bg-transparent text-xs border-none focus:outline-none w-16 text-text-primary"
                >
                  <option value="success">success</option>
                  <option value="failure">failure</option>
                </select>
              )}
              <span className="text-text-muted text-[10px]">&rarr;</span>
              <select
                value={t.goto}
                onChange={e => {
                  const newTransitions = [...step.transitions]
                  newTransitions[ti] = { ...t, goto: e.target.value }
                  update('transitions', newTransitions)
                }}
                className="bg-transparent text-xs border-none focus:outline-none w-24 text-text-primary font-mono"
              >
                <option value="">—</option>
                {gotoOptions.map(id => <option key={id} value={id}>{id === '$done' ? 'Done' : id === '$blocked' ? 'Blocked' : id}</option>)}
              </select>
              <button
                onClick={() => update('transitions', step.transitions.filter((_, i) => i !== ti))}
                className="p-0.5 text-text-muted hover:text-accent-error flex-shrink-0"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
          {step.transitions.length === 0 && <p className="text-text-muted text-[10px] italic">No transitions</p>}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Default Steps
// ============================================================================

const DEFAULT_STEPS: PipelineStep[] = [
  {
    id: 'build', name: 'Builder', type: 'llm_turn', phase: 'build', toolMode: 'builder',
    transitions: [
      { when: { type: 'any_criteria_blocked' }, goto: '$blocked' },
      { when: { type: 'all_criteria_completed_or_passed' }, goto: 'verify' },
      { when: { type: 'always' }, goto: 'build' },
    ],
  },
  {
    id: 'verify', name: 'Verifier', type: 'sub_agent', phase: 'verification', subAgentType: 'verifier',
    transitions: [
      { when: { type: 'any_criteria_blocked' }, goto: '$blocked' },
      { when: { type: 'all_criteria_passed' }, goto: '$done' },
      { when: { type: 'always' }, goto: 'build' },
    ],
  },
]

// ============================================================================
// Main Modal
// ============================================================================

export function PipelinesModal({ isOpen, onClose }: PipelinesModalProps) {
  const pipelines = usePipelinesStore(state => state.pipelines)
  const loading = usePipelinesStore(state => state.loading)
  const fetchPipelines = usePipelinesStore(state => state.fetchPipelines)
  const fetchPipeline = usePipelinesStore(state => state.fetchPipeline)
  const createPipeline = usePipelinesStore(state => state.createPipeline)
  const updatePipeline = usePipelinesStore(state => state.updatePipeline)
  const deletePipelineAction = usePipelinesStore(state => state.deletePipeline)
  const activatePipeline = usePipelinesStore(state => state.activatePipeline)

  const [view, setView] = useState<'list' | 'edit'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formId, setFormId] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formVersion, setFormVersion] = useState('1.0.0')
  const [formEntryStep, setFormEntryStep] = useState('build')
  const [formMaxIterations, setFormMaxIterations] = useState(50)
  const [formMaxVerifyRetries, setFormMaxVerifyRetries] = useState(4)
  const [formSteps, setFormSteps] = useState<PipelineStep[]>(DEFAULT_STEPS)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [subAgentTypes, setSubAgentTypes] = useState<SubAgentTypeInfo[]>([])

  useEffect(() => {
    if (isOpen) {
      fetchPipelines()
      fetch('/api/sub-agent-types').then(r => r.json()).then(d => setSubAgentTypes(d.types ?? [])).catch(() => {})
      setView('list')
      setEditingId(null)
      setConfirmDeleteId(null)
      setSelectedStepId(null)
    }
  }, [isOpen, fetchPipelines])

  const handleNew = () => {
    setEditingId(null)
    setFormName('')
    setFormId('')
    setFormDescription('')
    setFormVersion('1.0.0')
    setFormEntryStep('decide')
    setFormMaxIterations(50)
    setFormMaxVerifyRetries(4)
    setFormSteps(structuredClone(DEFAULT_STEPS))
    setFormError('')
    setSelectedStepId(null)
    setView('edit')
  }

  const handleEdit = async (pipelineId: string) => {
    const pipeline = await fetchPipeline(pipelineId)
    if (!pipeline) return
    setEditingId(pipelineId)
    setFormName(pipeline.metadata.name)
    setFormId(pipeline.metadata.id)
    setFormDescription(pipeline.metadata.description)
    setFormVersion(pipeline.metadata.version)
    setFormEntryStep(pipeline.entryStep)
    setFormMaxIterations(pipeline.settings.maxIterations)
    setFormMaxVerifyRetries(pipeline.settings.maxVerifyRetries)
    setFormSteps(pipeline.steps)
    setFormError('')
    setSelectedStepId(null)
    setView('edit')
  }

  const handleActivate = async (pipelineId: string) => {
    await activatePipeline(pipelineId)
  }

  const handleSave = async () => {
    const id = editingId ?? formId
    if (!id || !formName) { setFormError('Name is required.'); return }
    if (formSteps.length === 0) { setFormError('Pipeline must have at least one step.'); return }
    if (!formSteps.some(s => s.id === formEntryStep)) { setFormError(`Entry step "${formEntryStep}" doesn't match any step.`); return }

    setSaving(true)
    setFormError('')

    const pipeline: PipelineFull = {
      metadata: { id, name: formName, description: formDescription, version: formVersion || '1.0.0' },
      entryStep: formEntryStep,
      settings: { maxIterations: formMaxIterations, maxVerifyRetries: formMaxVerifyRetries },
      steps: formSteps,
    }

    const result = editingId ? await updatePipeline(editingId, pipeline) : await createPipeline(pipeline)
    setSaving(false)
    if (!result.success) { setFormError(result.error ?? 'Failed to save.'); return }
    setView('list')
  }

  const handleNameChange = (name: string) => {
    setFormName(name)
    if (!editingId) setFormId(toSlug(name))
  }

  const allStepIds = formSteps.map(s => s.id).filter(Boolean)
  const selectedStep = formSteps.find(s => s.id === selectedStepId) ?? null

  const updateStep = useCallback((updated: PipelineStep) => {
    setFormSteps(prev => prev.map(s => s.id === selectedStepId ? updated : s))
  }, [selectedStepId])

  const addStep = () => {
    const newStep: PipelineStep = { id: '', name: '', type: 'llm_turn', phase: 'build', toolMode: 'builder', transitions: [] }
    setFormSteps([...formSteps, newStep])
    setSelectedStepId('')
  }

  // ============================================================================
  // Edit View
  // ============================================================================

  if (view === 'edit') {
    return (
      <Modal isOpen={isOpen} onClose={() => setView('list')} title={editingId ? 'Edit Pipeline' : 'New Pipeline'} size="full">
        {formError && (
          <div className="text-accent-error text-sm px-3 py-2 bg-accent-error/10 rounded mb-3">{formError}</div>
        )}

        {/* Metadata bar */}
        <div className="flex items-end gap-3 mb-4 pb-3 border-b border-border flex-wrap">
          <div className="min-w-[140px]">
            <label className={labelClass}>Name</label>
            <input value={formName} onChange={e => handleNameChange(e.target.value)} placeholder="Pipeline name" className={inputClass} />
          </div>
          <div className="min-w-[100px]">
            <label className={labelClass}>ID</label>
            <input value={formId} onChange={e => !editingId && setFormId(e.target.value)} readOnly={!!editingId} className={`${inputClass} font-mono ${editingId ? 'opacity-50' : ''}`} />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className={labelClass}>Description</label>
            <input value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="What does this pipeline do?" className={inputClass} />
          </div>
          <div className="w-20">
            <label className={labelClass}>Max Iter.</label>
            <input type="number" value={formMaxIterations} onChange={e => setFormMaxIterations(Number(e.target.value))} className={`${inputClass} font-mono`} />
          </div>
          <div className="w-20">
            <label className={labelClass}>Max Retries</label>
            <input type="number" value={formMaxVerifyRetries} onChange={e => setFormMaxVerifyRetries(Number(e.target.value))} className={`${inputClass} font-mono`} />
          </div>
        </div>

        {/* Main area: flow + panel */}
        <div className="flex gap-4 min-h-[350px]">
          {/* Flow diagram */}
          <div className="flex-1 min-w-0 bg-bg-primary/50 border border-border rounded-lg p-2 overflow-auto">
            <div className="flex items-center justify-between mb-1 px-1">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-medium">Flow</span>
              <button onClick={addStep} className="text-[11px] text-accent-primary hover:text-accent-primary/80">+ Add Step</button>
            </div>
            <FlowDiagram
              steps={formSteps}
              entryStep={formEntryStep}
              selectedId={selectedStepId}
              onSelect={setSelectedStepId}
            />
          </div>

          {/* Properties panel */}
          <div className="w-[320px] flex-shrink-0 border border-border rounded-lg bg-bg-secondary overflow-y-auto">
            <div className="px-3 py-2 border-b border-border">
              <span className="text-[10px] text-text-muted uppercase tracking-wider font-medium">Properties</span>
            </div>
            <div className="p-3">
              {selectedStep ? (
                <StepPanel
                  step={selectedStep}
                  allStepIds={allStepIds}
                  isEntry={selectedStep.id === formEntryStep}
                  subAgentTypes={subAgentTypes}
                  onUpdate={updateStep}
                  onRemove={() => {
                    setFormSteps(formSteps.filter(s => s.id !== selectedStepId))
                    setSelectedStepId(null)
                  }}
                  onSetEntry={() => setFormEntryStep(selectedStep.id)}
                />
              ) : (
                <p className="text-text-muted text-xs text-center py-8">Click a node in the flow to edit its properties</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-border">
          <Button variant="secondary" onClick={() => setView('list')}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || !formName}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </Modal>
    )
  }

  // ============================================================================
  // List View
  // ============================================================================

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Pipelines" size="md">
      <div className="flex items-center justify-between mb-4">
        <p className="text-text-secondary text-sm">
          Pipelines define the orchestrator's step sequence when running tasks.
        </p>
        <Button variant="primary" size="sm" onClick={handleNew} className="flex-shrink-0 ml-3">+ New</Button>
      </div>

      {loading && pipelines.length === 0 ? (
        <div className="text-text-muted text-sm">Loading pipelines...</div>
      ) : pipelines.length === 0 ? (
        <div className="text-text-muted text-sm">No pipelines installed.</div>
      ) : (
        <div className="space-y-2">
          {pipelines.map(pipeline => (
            <div key={pipeline.id} className="flex items-center justify-between p-3 rounded border border-border bg-bg-tertiary">
              <div className="min-w-0 flex-1 mr-3">
                <div className="flex items-center gap-2">
                  <span className="text-text-primary text-sm font-medium">{pipeline.name}</span>
                  <span className="text-text-muted text-xs">v{pipeline.version}</span>
                </div>
                <p className="text-text-secondary text-xs mt-0.5 truncate">{pipeline.description}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => handleActivate(pipeline.id)} className="px-2 py-1 rounded text-xs bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 transition-colors" title="Set as active">Activate</button>
                <button onClick={() => handleEdit(pipeline.id)} className="p-1.5 rounded hover:bg-bg-primary text-text-muted hover:text-text-primary transition-colors" title="Edit">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
                {pipeline.id !== 'default' && (
                  confirmDeleteId === pipeline.id ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => { deletePipelineAction(pipeline.id); setConfirmDeleteId(null) }} className="px-1.5 py-0.5 rounded bg-accent-error/20 text-accent-error text-xs">Delete</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="px-1.5 py-0.5 rounded text-text-muted text-xs">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(pipeline.id)} className="p-1.5 rounded hover:bg-bg-primary text-text-muted hover:text-accent-error transition-colors" title="Delete">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
