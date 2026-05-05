import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { Modal } from '../shared/SelfContainedModal'
import { Button } from '../shared/Button'
import { EditButton } from '../shared/IconButton'
import { useWorkflowsStore, type WorkflowFull, type WorkflowStep, type TemplateVariable } from '../../stores/workflows'
import { ArrowRightIcon, EyeIcon } from '../shared/icons'
import type { AgentInfo } from '../../stores/agents'
import { authFetch } from '../../lib/api'
import { ConfirmButton, DeleteIcon, DuplicateIcon, useConfirmDialog } from './CRUDModal'

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

// ============================================================================
// Constants
// ============================================================================

const STEP_TYPES = [
  { value: 'agent', label: 'Agent' },
  { value: 'sub_agent', label: 'Sub-Agent' },
  { value: 'shell', label: 'Shell' },
] as const

const CONDITION_LABELS: Record<string, string> = {
  all_criteria_passed: 'All passed',
  all_criteria_completed_or_passed: 'All completed',
  any_criteria_blocked: 'Blocked',
  has_pending_criteria: 'Pending/Failed',
  step_result: 'Result',
  always: 'Always',
}

const CONDITION_TYPES = [
  { value: 'all_criteria_passed', label: 'All criteria passed' },
  { value: 'all_criteria_completed_or_passed', label: 'All criteria completed or passed' },
  { value: 'any_criteria_blocked', label: 'Any criteria blocked (retry limit)' },
  { value: 'has_pending_criteria', label: 'Has pending or failed criteria' },
  { value: 'step_result', label: 'Step result is...' },
  { value: 'always', label: 'Always (fallback)' },
] as const

const NODE_W = 150
const NODE_H = 54
const TERM_W = 80
const TERM_H = 30
const GAP_Y = 70
const COL_GAP = 100
const PAD = 50
const BACK_MARGIN = 50 // extra space on each side for back-edge routing + labels
const PORT_R = 4

// ============================================================================
// Helpers
// ============================================================================

function resolveAgent(step: WorkflowStep, agentTypes: AgentInfo[]): { name: string; color: string } {
  if (step.type === 'agent') {
    const agent = agentTypes.find((a) => a.id === step.toolMode)
    return { name: agent?.name ?? (step.toolMode || 'Agent'), color: agent?.color || '#3b82f6' }
  }
  if (step.type === 'sub_agent') {
    const agent = agentTypes.find((a) => a.id === step.subAgentType)
    return { name: agent?.name ?? (step.subAgentType || 'Sub-Agent'), color: agent?.color || '#a855f7' }
  }
  return { name: 'Shell', color: '#22c55e' }
}

// ============================================================================
// Layout Algorithm
// ============================================================================

interface LayoutNode {
  id: string
  type: 'step' | 'terminal'
  label: string
  color?: string
  cx: number
  cy: number
  w: number
  h: number
}

interface LayoutEdge {
  from: string
  to: string
  label: string
  edgeKey: string // 'start' | 'stepId:transIndex'
  direction: 'down' | 'back' | 'same'
  backEdgeIndex: number
  sameEdgeIndex: number
  fromPort: number
  toPort: number
}

function computeLayout(steps: WorkflowStep[], entryStep: string, startConditionLabel: string, agentTypes: AgentInfo[]) {
  const canvasW = BACK_MARGIN + PAD + NODE_W + COL_GAP + NODE_W + PAD + BACK_MARGIN
  const centerX = canvasW / 2
  const leftColCx = BACK_MARGIN + PAD + NODE_W / 2
  const rightColCx = BACK_MARGIN + PAD + NODE_W + COL_GAP + NODE_W / 2

  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []
  const posMap = new Map<string, { cx: number; cy: number; w: number; h: number }>()

  // Determine columns: left = agents/shell + Start/Done, right = sub-agents
  const leftSteps = steps.filter((s) => s.type === 'agent' || s.type === 'shell')
  const rightSteps = steps.filter((s) => s.type === 'sub_agent')
  const hasRight = rightSteps.length > 0
  const effectiveLeftCx = hasRight ? leftColCx : centerX
  const effectiveRightCx = leftSteps.length > 0 ? rightColCx : centerX

  // $start at top of left column
  const startCy = PAD + TERM_H / 2
  nodes.push({ id: '$start', type: 'terminal', label: 'Start', cx: effectiveLeftCx, cy: startCy, w: TERM_W, h: TERM_H })
  posMap.set('$start', { cx: effectiveLeftCx, cy: startCy, w: TERM_W, h: TERM_H })

  if (steps.length === 0) {
    const bottomY = startCy + TERM_H / 2 + GAP_Y * 2 + TERM_H / 2
    nodes.push({ id: '$done', type: 'terminal', label: 'Done', cx: effectiveLeftCx, cy: bottomY, w: TERM_W, h: TERM_H })
    posMap.set('$done', { cx: effectiveLeftCx, cy: bottomY, w: TERM_W, h: TERM_H })
    return { nodes, edges, width: canvasW, height: bottomY + TERM_H / 2 + PAD, posMap }
  }

  const startY = startCy + TERM_H / 2 + GAP_Y

  const placeColumn = (col: WorkflowStep[], cx: number) => {
    col.forEach((step, i) => {
      const cy = startY + i * (NODE_H + GAP_Y) + NODE_H / 2
      const { name: agentName, color } = resolveAgent(step, agentTypes)
      nodes.push({
        id: step.id,
        type: 'step',
        label: agentName,
        color,
        cx,
        cy,
        w: NODE_W,
        h: NODE_H,
      })
      posMap.set(step.id, { cx, cy, w: NODE_W, h: NODE_H })
    })
  }
  placeColumn(leftSteps, effectiveLeftCx)
  placeColumn(rightSteps, effectiveRightCx)

  const leftBot = leftSteps.length > 0 ? startY + (leftSteps.length - 1) * (NODE_H + GAP_Y) + NODE_H / 2 : startCy
  const rightBot = hasRight ? startY + (rightSteps.length - 1) * (NODE_H + GAP_Y) + NODE_H / 2 : startCy
  const bottomY = Math.max(leftBot, rightBot) + NODE_H / 2 + GAP_Y + TERM_H / 2

  // $done at bottom of left column
  nodes.push({ id: '$done', type: 'terminal', label: 'Done', cx: effectiveLeftCx, cy: bottomY, w: TERM_W, h: TERM_H })
  posMap.set('$done', { cx: effectiveLeftCx, cy: bottomY, w: TERM_W, h: TERM_H })

  // Build raw edges
  interface RawEdge {
    from: string
    to: string
    label: string
    edgeKey: string
    direction: 'down' | 'back' | 'same'
    backEdgeIndex: number
  }
  const rawEdges: RawEdge[] = []

  if (entryStep && posMap.has(entryStep)) {
    rawEdges.push({
      from: '$start',
      to: entryStep,
      label: startConditionLabel,
      edgeKey: 'start',
      direction: 'down',
      backEdgeIndex: 0,
    })
  }

  let backIdx = 0
  for (const step of steps) {
    step.transitions.forEach((t, ti) => {
      if (!t.goto || !posMap.has(t.goto)) return
      const fp = posMap.get(step.id)!
      const tp = posMap.get(t.goto)!
      const condLabel =
        t.when.type === 'step_result' ? `${t.when.result}` : (CONDITION_LABELS[t.when.type] ?? t.when.type)
      const isSelf = step.id === t.goto
      let dir: 'down' | 'back' | 'same'
      if (isSelf) dir = 'back'
      else if (tp.cy > fp.cy + 1) dir = 'down'
      else if (tp.cy < fp.cy - 1) dir = 'back'
      else dir = 'same'
      rawEdges.push({
        from: step.id,
        to: t.goto,
        label: condLabel,
        edgeKey: `${step.id}:${ti}`,
        direction: dir,
        backEdgeIndex: dir === 'back' ? backIdx++ : 0,
      })
    })
  }

  // Assign port offsets — only "down" edges use top/bottom ports
  const outCount = new Map<string, number>()
  const inCount = new Map<string, number>()
  const outIdx = new Map<string, number>()
  const inIdx = new Map<string, number>()
  for (const e of rawEdges) {
    if (e.direction !== 'down') continue
    outCount.set(e.from, (outCount.get(e.from) ?? 0) + 1)
    inCount.set(e.to, (inCount.get(e.to) ?? 0) + 1)
  }
  const samePairCount = new Map<string, number>()
  const samePairIdx = new Map<string, number>()
  for (const e of rawEdges) {
    if (e.direction !== 'same') continue
    const pairKey = [e.from, e.to].sort().join('|')
    samePairCount.set(pairKey, (samePairCount.get(pairKey) ?? 0) + 1)
  }

  for (const e of rawEdges) {
    if (e.direction === 'back' || e.direction === 'same') {
      let sei = 0
      if (e.direction === 'same') {
        const pairKey = [e.from, e.to].sort().join('|')
        sei = samePairIdx.get(pairKey) ?? 0
        samePairIdx.set(pairKey, sei + 1)
      }
      edges.push({ ...e, fromPort: 0, toPort: 0, sameEdgeIndex: sei })
      continue
    }
    const oc = outCount.get(e.from) ?? 1
    const ic = inCount.get(e.to) ?? 1
    const oi = outIdx.get(e.from) ?? 0
    const ii = inIdx.get(e.to) ?? 0
    outIdx.set(e.from, oi + 1)
    inIdx.set(e.to, ii + 1)
    const fp = oc === 1 ? 0 : -0.6 + (1.2 * oi) / (oc - 1)
    const tp = ic === 1 ? 0 : -0.6 + (1.2 * ii) / (ic - 1)
    edges.push({ ...e, fromPort: fp, toPort: tp, sameEdgeIndex: 0 })
  }

  return { nodes, edges, width: canvasW, height: bottomY + TERM_H / 2 + PAD, posMap }
}

// ============================================================================
// Drag State
// ============================================================================

interface DragState {
  type: 'new' | 'reconnect-to' | 'reconnect-from'
  fromNodeId: string // source node for new/reconnect-to
  fixedTargetId?: string // for reconnect-from: the fixed target
  edgeKey?: string // for reconnects: which edge
  mouseX: number
  mouseY: number
}

// ============================================================================
// SVG Flow Diagram
// ============================================================================

function FlowDiagram({
  steps,
  entryStep,
  selectedNodeId,
  selectedEdgeKey,
  startConditionLabel,
  agentTypes,
  isReadOnly,
  onSelectNode,
  onSelectEdge,
  onRemoveStep,
  onCreateTransition,
  onReconnectTo,
  onReconnectFrom,
  onDeleteTransition,
}: {
  steps: WorkflowStep[]
  entryStep: string
  selectedNodeId: string | null
  selectedEdgeKey: string | null
  startConditionLabel: string
  agentTypes: AgentInfo[]
  isReadOnly: boolean
  onSelectNode: (id: string | null) => void
  onSelectEdge: (key: string | null) => void
  onRemoveStep: (id: string) => void
  onCreateTransition: (fromNodeId: string, toNodeId: string) => void
  onReconnectTo: (edgeKey: string, newTarget: string) => void
  onReconnectFrom: (edgeKey: string, newSourceId: string) => void
  onDeleteTransition: (edgeKey: string) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragEndedRef = useRef(false)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dragHoverTarget, setDragHoverTarget] = useState<string | null>(null)

  const { nodes, edges, width, height, posMap } = useMemo(
    () => computeLayout(steps, entryStep, startConditionLabel, agentTypes),
    [steps, entryStep, startConditionLabel, agentTypes],
  )

  // SVG coordinate conversion
  const getSVGPoint = useCallback((e: React.MouseEvent | MouseEvent) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()?.inverse()
    if (!ctm) return { x: 0, y: 0 }
    const svgPt = pt.matrixTransform(ctm)
    return { x: svgPt.x, y: svgPt.y }
  }, [])

  // Valid drop target check
  const isValidTarget = useCallback(
    (nodeId: string): boolean => {
      if (!nodeId || !dragState) return false
      if (nodeId === '$start') return false
      if (dragState.type === 'reconnect-from') {
        // Source must be a step node (terminals don't have transitions)
        return nodeId !== '$done'
      }
      return true
    },
    [dragState],
  )

  // Drag handlers
  const startNewDrag = useCallback(
    (ev: React.MouseEvent, fromNodeId: string) => {
      if (isReadOnly) return
      ev.stopPropagation()
      ev.preventDefault()
      const pt = getSVGPoint(ev)
      setDragState({ type: 'new', fromNodeId, mouseX: pt.x, mouseY: pt.y })
    },
    [getSVGPoint, isReadOnly],
  )

  const startReconnectTo = useCallback(
    (ev: React.MouseEvent, edge: LayoutEdge) => {
      if (isReadOnly) return
      ev.stopPropagation()
      ev.preventDefault()
      const pt = getSVGPoint(ev)
      setDragState({ type: 'reconnect-to', fromNodeId: edge.from, edgeKey: edge.edgeKey, mouseX: pt.x, mouseY: pt.y })
    },
    [getSVGPoint, isReadOnly],
  )

  const startReconnectFrom = useCallback(
    (ev: React.MouseEvent, edge: LayoutEdge) => {
      if (isReadOnly) return
      ev.stopPropagation()
      ev.preventDefault()
      const pt = getSVGPoint(ev)
      setDragState({
        type: 'reconnect-from',
        fromNodeId: edge.from,
        fixedTargetId: edge.to,
        edgeKey: edge.edgeKey,
        mouseX: pt.x,
        mouseY: pt.y,
      })
    },
    [getSVGPoint, isReadOnly],
  )

  const handleMouseMove = useCallback(
    (ev: React.MouseEvent) => {
      if (!dragState) return
      const pt = getSVGPoint(ev)
      setDragState((prev) => (prev ? { ...prev, mouseX: pt.x, mouseY: pt.y } : null))
    },
    [dragState, getSVGPoint],
  )

  const handleMouseUp = useCallback(() => {
    if (!dragState) return
    dragEndedRef.current = true
    if (dragHoverTarget && isValidTarget(dragHoverTarget)) {
      if (dragState.type === 'new') {
        onCreateTransition(dragState.fromNodeId, dragHoverTarget)
      } else if (dragState.type === 'reconnect-to') {
        onReconnectTo(dragState.edgeKey!, dragHoverTarget)
      } else if (dragState.type === 'reconnect-from') {
        onReconnectFrom(dragState.edgeKey!, dragHoverTarget)
      }
    }
    setDragState(null)
    setDragHoverTarget(null)
  }, [dragState, dragHoverTarget, isValidTarget, onCreateTransition, onReconnectTo, onReconnectFrom])

  const handleBackgroundClick = useCallback(() => {
    if (dragEndedRef.current) {
      dragEndedRef.current = false
      return
    }
    onSelectNode(null)
    onSelectEdge(null)
  }, [onSelectNode, onSelectEdge])

  // Delete key handler
  useEffect(() => {
    if (isReadOnly) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEdgeKey && selectedEdgeKey !== 'start') {
        e.preventDefault()
        onDeleteTransition(selectedEdgeKey)
        onSelectEdge(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isReadOnly, selectedEdgeKey, onDeleteTransition, onSelectEdge])

  // Compute edge path and endpoints
  const computeEdgePath = (
    e: LayoutEdge,
  ): {
    path: string
    labelX: number
    labelY: number
    labelAnchor: 'middle' | 'start' | 'end'
    fromPt: { x: number; y: number }
    toPt: { x: number; y: number }
  } | null => {
    const from = posMap.get(e.from)
    const to = posMap.get(e.to)
    if (!from || !to) return null

    let path: string
    let labelX: number
    let labelY: number
    let labelAnchor: 'middle' | 'start' | 'end' = 'middle'
    let fromPt: { x: number; y: number }
    let toPt: { x: number; y: number }

    if (e.direction === 'down') {
      const x1 = from.cx + e.fromPort * (from.w / 2 - 10)
      const y1 = from.cy + from.h / 2
      const x2 = to.cx + e.toPort * (to.w / 2 - 10)
      const y2 = to.cy - to.h / 2
      const dy = y2 - y1
      const dx = x2 - x1
      // CP2 keeps some horizontal lean so the arrow tangent matches the visual curve direction
      path = `M ${x1} ${y1} C ${x1} ${y1 + dy * 0.4}, ${x2 - dx * 0.2} ${y2 - dy * 0.1}, ${x2} ${y2}`
      labelX = x1 + (x2 - x1) * 0.5
      labelY = y1 + dy * 0.6
      fromPt = { x: x1, y: y1 }
      toPt = { x: x2, y: y2 }
    } else if (e.direction === 'back') {
      const isSelf = e.from === e.to
      // Non-self back-edges: route toward canvas edge (left col → left, right col → right)
      const routeRight = from.cx >= width / 2
      const offset = e.backEdgeIndex * 16
      const edgeX = routeRight ? width - 20 - offset : 20 + offset

      if (isSelf) {
        // Self-loops: exit from outer side, arc above, re-enter at top
        const loopRight = from.cx >= width / 2
        const loopOut = 30 + e.backEdgeIndex * 14
        const top = from.cy - from.h / 2
        const side = loopRight ? from.cx + from.w / 2 : from.cx - from.w / 2
        const outX = loopRight ? side + loopOut : side - loopOut
        const enterX = from.cx + (loopRight ? from.w / 4 : -from.w / 4)
        const peakY = top - 20 - e.backEdgeIndex * 10
        path = `M ${side} ${from.cy} C ${outX} ${from.cy}, ${outX} ${peakY}, ${enterX} ${top}`
        // Place label above the loop arc, toward the outer side
        labelX = outX + 10
        labelY = peakY + 4
        labelAnchor = 'middle'
        fromPt = { x: side, y: from.cy }
        toPt = { x: enterX, y: top }
      } else {
        const x1 = routeRight ? from.cx + from.w / 2 : from.cx - from.w / 2
        const x2 = to.cx + (routeRight ? to.w / 4 : -to.w / 4)
        const topY = Math.min(from.cy, to.cy) - to.h / 2 - 18 - e.backEdgeIndex * 14
        path = `M ${x1} ${from.cy} L ${edgeX} ${from.cy} L ${edgeX} ${topY} L ${x2} ${topY} L ${x2} ${to.cy - to.h / 2}`
        labelX = edgeX
        labelY = (from.cy + topY) / 2
        labelAnchor = routeRight ? 'start' : 'end'
        fromPt = { x: x1, y: from.cy }
        toPt = { x: x2, y: to.cy - to.h / 2 }
      }
    } else {
      // Same level (cross-column)
      const goesRight = to.cx > from.cx
      const yOff = e.sameEdgeIndex === 0 ? -12 : 12
      const x1 = goesRight ? from.cx + from.w / 2 : from.cx - from.w / 2
      const x2 = goesRight ? to.cx - to.w / 2 : to.cx + to.w / 2
      const y1 = from.cy + yOff
      const y2 = to.cy + yOff
      const midX = (x1 + x2) / 2
      path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
      labelX = midX
      labelY = (y1 + y2) / 2 - 6
      fromPt = { x: x1, y: y1 }
      toPt = { x: x2, y: y2 }
    }

    return { path, labelX, labelY, labelAnchor, fromPt, toPt }
  }

  const renderEdge = (e: LayoutEdge, i: number) => {
    const computed = computeEdgePath(e)
    if (!computed) return null
    const { path, labelX, labelY, labelAnchor } = computed

    const isSelected = selectedEdgeKey === e.edgeKey
    const showLabel = e.label && !(e.from === '$start' && e.label === 'Always')

    return (
      <g key={i}>
        {/* Hit area — invisible wide stroke for clicking */}
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          className="cursor-pointer"
          onClick={(ev) => {
            ev.stopPropagation()
            onSelectEdge(isSelected ? null : e.edgeKey)
          }}
        />
        {/* Visible edge */}
        <path
          d={path}
          fill="none"
          stroke={isSelected ? '#58a6ff' : '#484f58'}
          strokeWidth={isSelected ? 2.2 : 1.2}
          markerEnd={isSelected ? 'url(#arrow-selected)' : 'url(#arrow)'}
          pointerEvents="none"
        />
        {showLabel && (
          <text
            x={labelX + (labelAnchor === 'start' ? 5 : labelAnchor === 'end' ? -5 : 0)}
            y={labelY + 3}
            textAnchor={labelAnchor}
            className="text-[8px]"
            fill={isSelected ? '#79c0ff' : '#8b949e'}
            style={{ paintOrder: 'stroke', stroke: '#0d1117', strokeWidth: 3, strokeLinejoin: 'round' }}
            pointerEvents="none"
          >
            {e.label}
          </text>
        )}
      </g>
    )
  }

  // Render handles on selected edge for reconnection
  const renderEdgeHandles = () => {
    if (!selectedEdgeKey || dragState) return null
    const edge = edges.find((e) => e.edgeKey === selectedEdgeKey)
    if (!edge) return null
    const computed = computeEdgePath(edge)
    if (!computed) return null

    const { fromPt, toPt } = computed
    const handleR = 6

    return (
      <>
        {/* From handle — not shown for start edge */}
        {edge.edgeKey !== 'start' && (
          <circle
            cx={fromPt.x}
            cy={fromPt.y}
            r={handleR}
            fill="#58a6ff"
            fillOpacity={0.25}
            stroke="#58a6ff"
            strokeWidth={2}
            strokeOpacity={0.8}
            className="cursor-grab"
            onMouseDown={(ev) => startReconnectFrom(ev, edge)}
          />
        )}
        {/* To handle */}
        <circle
          cx={toPt.x}
          cy={toPt.y}
          r={handleR}
          fill="#58a6ff"
          fillOpacity={0.25}
          stroke="#58a6ff"
          strokeWidth={2}
          strokeOpacity={0.8}
          className="cursor-grab"
          onMouseDown={(ev) => startReconnectTo(ev, edge)}
        />
      </>
    )
  }

  // Render temporary drag line
  const renderDragLine = () => {
    if (!dragState) return null

    let x1: number, y1: number, x2: number, y2: number

    if (dragState.type === 'reconnect-from') {
      const targetNode = posMap.get(dragState.fixedTargetId!)
      if (!targetNode) return null
      x1 = dragState.mouseX
      y1 = dragState.mouseY
      x2 = targetNode.cx
      y2 = targetNode.cy - targetNode.h / 2
    } else {
      const sourceNode = posMap.get(dragState.fromNodeId)
      if (!sourceNode) return null
      x1 = sourceNode.cx
      y1 = sourceNode.cy + sourceNode.h / 2
      x2 = dragState.mouseX
      y2 = dragState.mouseY
    }

    const dy = y2 - y1
    const path =
      Math.abs(dy) > 10
        ? `M ${x1} ${y1} C ${x1} ${y1 + dy * 0.4}, ${x2} ${y2 - dy * 0.4}, ${x2} ${y2}`
        : `M ${x1} ${y1} L ${x2} ${y2}`

    return (
      <path
        d={path}
        fill="none"
        stroke="#58a6ff"
        strokeWidth={2}
        strokeDasharray="6 3"
        strokeOpacity={0.7}
        pointerEvents="none"
      />
    )
  }

  // Render output port (bottom of node)
  const renderOutputPort = (node: LayoutNode) => {
    const py = node.cy + node.h / 2
    const isActive = dragState?.fromNodeId === node.id
    return (
      <circle
        cx={node.cx}
        cy={py}
        r={PORT_R}
        fill={isActive ? '#58a6ff' : '#1c2128'}
        stroke={isActive ? '#58a6ff' : '#484f58'}
        strokeWidth={1.5}
        strokeOpacity={isActive ? 1 : 0.5}
        className="cursor-crosshair"
        onMouseDown={(ev) => startNewDrag(ev, node.id)}
      />
    )
  }

  // Render input port (top of node)
  const renderInputPort = (node: LayoutNode) => {
    const py = node.cy - node.h / 2
    const isTarget = dragState && dragHoverTarget === node.id && isValidTarget(node.id)
    return (
      <circle
        cx={node.cx}
        cy={py}
        r={PORT_R}
        fill={isTarget ? '#3fb950' : '#1c2128'}
        stroke={isTarget ? '#3fb950' : '#484f58'}
        strokeWidth={1.5}
        strokeOpacity={isTarget ? 1 : 0.5}
      />
    )
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="block w-full"
      preserveAspectRatio="xMidYMin meet"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleBackgroundClick}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="7" markerHeight="5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#484f58" />
        </marker>
        <marker
          id="arrow-selected"
          viewBox="0 0 10 7"
          refX="10"
          refY="3.5"
          markerWidth="7"
          markerHeight="5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="#58a6ff" />
        </marker>
      </defs>

      {/* Edges */}
      {edges.map((e, i) => renderEdge(e, i))}

      {/* Nodes */}
      {nodes.map((node) => {
        const isNodeSelected = selectedNodeId === node.id
        const x = node.cx - node.w / 2
        const y = node.cy - node.h / 2
        const isHovered = hoveredNodeId === node.id
        const isDragTarget = dragState && dragHoverTarget === node.id && isValidTarget(node.id)

        if (node.type === 'terminal') {
          const isStart = node.id === '$start'
          const color = isStart ? '#58a6ff' : '#3fb950'
          const hasOutput = isStart
          const hasInput = !isStart

          return (
            <g
              key={node.id}
              onClick={(ev) => {
                ev.stopPropagation()
                if (isStart && !isReadOnly) {
                  onSelectEdge('start')
                }
              }}
              className={isStart && !isReadOnly ? 'cursor-pointer' : undefined}
            >
              {isDragTarget && (
                <rect
                  x={x - 3}
                  y={y - 3}
                  width={node.w + 6}
                  height={node.h + 6}
                  rx={node.h / 2 + 3}
                  fill="none"
                  stroke="#3fb950"
                  strokeOpacity={0.6}
                  strokeWidth={2}
                />
              )}
              {isStart && selectedEdgeKey === 'start' && (
                <rect
                  x={x - 3}
                  y={y - 3}
                  width={node.w + 6}
                  height={node.h + 6}
                  rx={node.h / 2 + 3}
                  fill="none"
                  stroke="#58a6ff"
                  strokeOpacity={0.5}
                  strokeWidth={2}
                />
              )}
              <rect
                x={x}
                y={y}
                width={node.w}
                height={node.h}
                rx={node.h / 2}
                fill={color}
                fillOpacity={0.08}
                stroke={color}
                strokeOpacity={0.4}
                strokeWidth={1.5}
              />
              <text
                x={node.cx}
                y={node.cy + 4}
                textAnchor="middle"
                fill={color}
                className="text-[10px] font-medium"
                pointerEvents="none"
              >
                {node.label}
              </text>
              {hasOutput && renderOutputPort(node)}
              {hasInput && renderInputPort(node)}
            </g>
          )
        }

        const color = node.color ?? '#6b7280'
        return (
          <g
            key={node.id}
            onClick={(ev) => {
              ev.stopPropagation()
              if (!isReadOnly) onSelectNode(isNodeSelected ? null : node.id)
            }}
            onMouseEnter={() => setHoveredNodeId(node.id)}
            onMouseLeave={() => setHoveredNodeId(null)}
            className={isReadOnly ? undefined : 'cursor-pointer'}
          >
            {isDragTarget && (
              <rect
                x={x - 3}
                y={y - 3}
                width={node.w + 6}
                height={node.h + 6}
                rx={12}
                fill="none"
                stroke="#3fb950"
                strokeOpacity={0.6}
                strokeWidth={2}
              />
            )}
            {isNodeSelected && (
              <rect
                x={x - 3}
                y={y - 3}
                width={node.w + 6}
                height={node.h + 6}
                rx={12}
                fill="none"
                stroke="#58a6ff"
                strokeOpacity={0.5}
                strokeWidth={2}
              />
            )}
            <rect
              x={x}
              y={y}
              width={node.w}
              height={node.h}
              rx={10}
              fill={color}
              fillOpacity={0.08}
              stroke={color}
              strokeOpacity={0.6}
              strokeWidth={isNodeSelected ? 2 : 1.5}
            />
            <text
              x={node.cx}
              y={node.cy + 4}
              textAnchor="middle"
              fill="#c9d1d9"
              className="text-[11px] font-medium"
              pointerEvents="none"
            >
              {node.label}
            </text>
            {/* Ports */}
            {!isReadOnly && renderOutputPort(node)}
            {!isReadOnly && renderInputPort(node)}
            {/* Hover delete button */}
            {isHovered && !dragState && !isReadOnly && (
              <g
                onClick={(ev) => {
                  ev.stopPropagation()
                  onRemoveStep(node.id)
                }}
                className="cursor-pointer"
              >
                <circle
                  cx={x + node.w - 2}
                  cy={y + 2}
                  r={8}
                  fill="#0d1117"
                  fillOpacity={0.9}
                  stroke="#f85149"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                />
                <line
                  x1={x + node.w - 5}
                  y1={y - 1}
                  x2={x + node.w + 1}
                  y2={y + 5}
                  stroke="#f85149"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
                <line
                  x1={x + node.w + 1}
                  y1={y - 1}
                  x2={x + node.w - 5}
                  y2={y + 5}
                  stroke="#f85149"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                />
              </g>
            )}
          </g>
        )
      })}

      {/* Drop target overlay during drag — large invisible hit areas */}
      {dragState &&
        nodes.map((node) => {
          if (!isValidTarget(node.id)) return null
          return (
            <rect
              key={`drop-${node.id}`}
              x={node.cx - node.w / 2 - 8}
              y={node.cy - node.h / 2 - 8}
              width={node.w + 16}
              height={node.h + 16}
              fill="transparent"
              rx={12}
              onMouseEnter={() => setDragHoverTarget(node.id)}
              onMouseLeave={() => setDragHoverTarget(null)}
              onMouseUp={(ev) => {
                ev.stopPropagation()
                handleMouseUp()
              }}
            />
          )
        })}

      {/* Drag visual */}
      {renderDragLine()}

      {/* Reconnection handles on selected edge */}
      {renderEdgeHandles()}
    </svg>
  )
}

// ============================================================================
// Transition Properties Panel
// ============================================================================

const inputClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const selectClass =
  'w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-accent-primary'
const labelClass = 'block text-[11px] text-text-secondary mb-0.5'

function TransitionPanel({
  fromLabel,
  toLabel,
  condition,
  fromStep,
  agentTypes,
  onUpdateCondition,
  onDelete,
}: {
  fromLabel: string
  toLabel: string
  condition: { type: string; result?: string }
  fromStep?: WorkflowStep
  agentTypes: AgentInfo[]
  onUpdateCondition: (when: { type: string; result?: string }) => void
  onDelete: () => void
}) {
  const stepAgent =
    fromStep && (fromStep.type === 'sub_agent' || fromStep.type === 'agent')
      ? agentTypes.find((a) => a.id === (fromStep.type === 'sub_agent' ? fromStep.subAgentType : fromStep.toolMode))
      : undefined
  const hasResults = stepAgent?.results && stepAgent.results.length > 0

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-300">Transition</span>
        <button onClick={onDelete} className="p-1 rounded text-text-muted hover:text-accent-error text-xs">
          Delete
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
        <span className="font-medium text-text-primary">{fromLabel}</span>
        <ArrowRightIcon />
        <span className="font-medium text-text-primary">{toLabel}</span>
      </div>

      <div>
        <label className={labelClass}>Condition</label>
        <select
          value={condition.type}
          onChange={(e) => {
            onUpdateCondition(
              e.target.value === 'step_result' ? { type: 'step_result', result: 'success' } : { type: e.target.value },
            )
          }}
          className={selectClass}
        >
          {CONDITION_TYPES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {condition.type === 'step_result' && (
        <div>
          <label className={labelClass}>Result</label>
          {hasResults ? (
            <select
              value={condition.result ?? stepAgent!.results![0]}
              onChange={(e) => {
                onUpdateCondition({ type: 'step_result', result: e.target.value })
              }}
              className={selectClass}
            >
              {stepAgent!.results!.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={condition.result ?? 'success'}
              onChange={(e) => onUpdateCondition({ type: 'step_result', result: e.target.value })}
              placeholder="e.g. success, passed, failed"
              className={inputClass}
            />
          )}
        </div>
      )}

      <p className="text-text-muted text-[10px]">Drag handles to reconnect. Press Delete to remove.</p>
    </div>
  )
}

// ============================================================================
// Step Properties Panel
// ============================================================================

function TemplateVariablesHint({
  variables,
  onInsert,
}: {
  variables: TemplateVariable[]
  onInsert: (name: string) => void
}) {
  if (variables.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {variables.map((v) => (
        <button
          key={v.name}
          type="button"
          onClick={() => onInsert(v.name)}
          title={v.description}
          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-bg-primary border border-border text-text-secondary hover:text-accent-primary hover:border-accent-primary/40 transition-colors"
        >
          {`{{${v.name}}}`}
        </button>
      ))}
    </div>
  )
}

function StepPanel({
  step,
  isEntry,
  agentTypes,
  transitionCount,
  templateVariables,
  onUpdate,
  onRemove,
  onSetEntry,
}: {
  step: WorkflowStep
  isEntry: boolean
  agentTypes: AgentInfo[]
  transitionCount: number
  templateVariables: TemplateVariable[]
  onUpdate: (step: WorkflowStep) => void
  onRemove: () => void
  onSetEntry: () => void
}) {
  const { color, name: agentName } = resolveAgent(step, agentTypes)

  return (
    <div className="space-y-3 text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
            style={{ backgroundColor: color + '20', color }}
          >
            {agentName}
          </span>
          {isEntry && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent-primary/15 text-accent-primary">
              Entry
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!isEntry && (
            <button onClick={onSetEntry} className="p-1 rounded text-text-muted hover:text-accent-primary text-xs">
              Set entry
            </button>
          )}
          <button onClick={onRemove} className="p-1 rounded text-text-muted hover:text-accent-error text-xs">
            Delete
          </button>
        </div>
      </div>

      {/* Type */}
      <div>
        <label className={labelClass}>Type</label>
        <select
          value={step.type}
          onChange={(e) => {
            const newType = e.target.value as WorkflowStep['type']
            const phase = newType === 'sub_agent' ? 'verification' : 'build'
            if (newType === 'agent') {
              const agent = agentTypes.find((a) => !a.subagent)
              onUpdate({
                ...step,
                type: newType,
                phase,
                toolMode: (agent?.id ?? 'builder') as 'builder' | 'planner',
                name: agent?.name ?? 'Agent',
              })
            } else if (newType === 'sub_agent') {
              const agent = agentTypes.find((a) => a.subagent)
              onUpdate({
                ...step,
                type: newType,
                phase,
                subAgentType: agent?.id ?? '',
                name: agent?.name ?? 'Sub-Agent',
              })
            } else {
              onUpdate({ ...step, type: newType, phase, name: 'Shell' })
            }
          }}
          className={selectClass}
        >
          {STEP_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Type-specific */}
      {step.type === 'agent' && (
        <div>
          <label className={labelClass}>Agent Type</label>
          <select
            value={step.toolMode ?? 'builder'}
            onChange={(e) => {
              const agent = agentTypes.find((a) => a.id === e.target.value)
              onUpdate({
                ...step,
                toolMode: e.target.value as 'builder' | 'planner',
                name: agent?.name ?? e.target.value,
              })
            }}
            className={selectClass}
          >
            {agentTypes
              .filter((a) => !a.subagent)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </div>
      )}

      {step.type === 'sub_agent' && (
        <div>
          <label className={labelClass}>Sub-Agent Type</label>
          <select
            value={step.subAgentType ?? ''}
            onChange={(e) => {
              const agent = agentTypes.find((a) => a.id === e.target.value)
              onUpdate({ ...step, subAgentType: e.target.value, name: agent?.name ?? e.target.value })
            }}
            className={selectClass}
          >
            <option value="">— select —</option>
            {agentTypes
              .filter((a) => a.subagent)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </div>
      )}

      {(step.type === 'agent' || step.type === 'sub_agent') && (
        <>
          <div>
            <label className={labelClass}>Prompt</label>
            <textarea
              value={step.prompt ?? ''}
              onChange={(e) => onUpdate({ ...step, prompt: e.target.value || undefined })}
              rows={6}
              className={`${inputClass} resize-y text-xs`}
              placeholder="Injected on first entry..."
            />
            <TemplateVariablesHint
              variables={templateVariables}
              onInsert={(name) => onUpdate({ ...step, prompt: (step.prompt ?? '') + `{{${name}}}` })}
            />
          </div>
          <div>
            <label className={labelClass}>Nudge Prompt</label>
            <textarea
              value={step.nudgePrompt ?? ''}
              onChange={(e) => onUpdate({ ...step, nudgePrompt: e.target.value || undefined })}
              rows={6}
              className={`${inputClass} resize-y text-xs`}
              placeholder="Injected on re-entry..."
            />
            <TemplateVariablesHint
              variables={templateVariables}
              onInsert={(name) => onUpdate({ ...step, nudgePrompt: (step.nudgePrompt ?? '') + `{{${name}}}` })}
            />
          </div>
        </>
      )}

      {step.type === 'shell' && (
        <>
          <div>
            <label className={labelClass}>Command</label>
            <textarea
              value={step.command ?? ''}
              onChange={(e) => onUpdate({ ...step, command: e.target.value })}
              rows={3}
              className={`${inputClass} font-mono text-xs resize-y`}
              placeholder="cd {{workdir}} && npm run lint"
            />
            <TemplateVariablesHint
              variables={templateVariables}
              onInsert={(name) => onUpdate({ ...step, command: (step.command ?? '') + `{{${name}}}` })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Timeout (ms)</label>
              <input
                type="number"
                value={step.timeout ?? 60000}
                onChange={(e) => onUpdate({ ...step, timeout: Number(e.target.value) })}
                className={`${inputClass} font-mono text-xs`}
              />
            </div>
            <div>
              <label className={labelClass}>Success Codes</label>
              <input
                value={(step.successExitCodes ?? [0]).join(', ')}
                onChange={(e) =>
                  onUpdate({
                    ...step,
                    successExitCodes: e.target.value
                      .split(',')
                      .map((s) => Number(s.trim()))
                      .filter((n) => !isNaN(n)),
                  })
                }
                className={`${inputClass} font-mono text-xs`}
              />
            </div>
          </div>
        </>
      )}

      {/* Transition count (read-only) */}
      <div className="pt-1 border-t border-border/50">
        <p className="text-text-muted text-[10px]">
          {transitionCount} outgoing transition{transitionCount !== 1 ? 's' : ''} — drag from the bottom port to
          connect.
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// Default Steps
// ============================================================================

const DEFAULT_STEPS: WorkflowStep[] = []

// ============================================================================
// Main Modal
// ============================================================================

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

  // Form state
  const [formName, setFormName] = useState('')
  const [formId, setFormId] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formVersion, setFormVersion] = useState('1.0.0')
  const [formColor, setFormColor] = useState('#3b82f6')
  const [formEntryStep, setFormEntryStep] = useState('')
  const [formMaxIterations, setFormMaxIterations] = useState(50)

  const [formSteps, setFormSteps] = useState<WorkflowStep[]>(DEFAULT_STEPS)
  const [formStartCondition, setFormStartCondition] = useState<{ type: string; result?: string }>({ type: 'always' })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [agentTypes, setAgentTypes] = useState<AgentInfo[]>([])

  const [_confirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      fetchWorkflows()
      fetchTemplateVariables()
      authFetch('/api/agents')
        .then((r) => r.json())
        .then((d) => setAgentTypes(d.agents ?? []))
        .catch(() => {})
      setSelectedNodeKey(null)
      setSelectedEdgeKey(null)
      if (initialEditId) {
        const isDefault = defaults.some((d) => d.id === initialEditId)
        if (isDefault) {
          fetchDefaultContent(initialEditId).then((workflow) => {
            if (!workflow) return
            setFormName(workflow.metadata.name + ' (copy)')
            setFormId(`${initialEditId}-copy-${Date.now()}`)
            setFormDescription(workflow.metadata.description)
            setFormVersion(workflow.metadata.version)
            setFormColor(workflow.metadata.color ?? '#3b82f6')
            setFormEntryStep(workflow.entryStep)
            setFormMaxIterations(workflow.settings.maxIterations)
            setFormSteps(workflow.steps)
            setFormStartCondition(workflow.startCondition ?? { type: 'always' })
            setFormError('')
            setEditingId(null)
            setIsReadOnly(false)
            setView('edit')
          })
        } else {
          fetchWorkflow(initialEditId).then((workflow) => {
            if (!workflow) return
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
            setEditingId(initialEditId)
            setIsReadOnly(false)
            setView('edit')
          })
        }
      } else {
        setView('list')
        setEditingId(null)
        setIsReadOnly(false)
      }
    }
  }, [isOpen, fetchWorkflows, fetchWorkflow, fetchDefaultContent, fetchTemplateVariables, initialEditId])

  const handleEdit = async (workflowId: string) => {
    const workflow = await fetchWorkflow(workflowId)
    if (!workflow) return
    setEditingId(workflowId)
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
    setSelectedNodeKey(null)
    setSelectedEdgeKey(null)
    setView('edit')
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
      initialEditId ? onClose() : setView('list')
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

  const handleView = async (workflowId: string) => {
    const isDefault = defaults.some((d) => d.id === workflowId)
    if (isDefault) {
      const content = await fetchDefaultContent(workflowId)
      if (!content) return
      setFormName(content.metadata.name)
      setFormId(content.metadata.id)
      setFormDescription(content.metadata.description)
      setFormVersion(content.metadata.version)
      setFormColor(content.metadata.color ?? '#3b82f6')
      setFormEntryStep(content.entryStep)
      setFormMaxIterations(content.settings.maxIterations)
      setFormSteps(content.steps)
      setFormStartCondition(content.startCondition ?? { type: 'always' })
      setFormError('')
      setEditingId(workflowId)
      setIsReadOnly(true)
    } else {
      const workflow = await fetchWorkflow(workflowId)
      if (!workflow) return
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
      setEditingId(workflowId)
      setIsReadOnly(true)
    }
    setView('edit')
  }

  const handleDuplicate = async (workflowId: string) => {
    const isDefault = defaults.some((d) => d.id === workflowId)
    const content = isDefault ? await fetchDefaultContent(workflowId) : await fetchWorkflow(workflowId)
    if (!content) return
    setFormName(content.metadata.name + ' (copy)')
    setFormId(`${workflowId}-copy-${Date.now()}`)
    setFormDescription(content.metadata.description)
    setFormVersion(content.metadata.version)
    setFormColor(content.metadata.color ?? '#3b82f6')
    setFormEntryStep(content.entryStep)
    setFormMaxIterations(content.settings.maxIterations)
    setFormSteps(content.steps)
    setFormStartCondition(content.startCondition ?? { type: 'always' })
    setFormError('')
    setEditingId(null)
    setIsReadOnly(false)
    setView('edit')
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

  // Selection helpers
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

  // Transition action handlers
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

  const handleReconnectTo = useCallback((edgeKey: string, newTarget: string) => {
    if (edgeKey === 'start') {
      setFormEntryStep(newTarget)
    } else {
      const sepIdx = edgeKey.lastIndexOf(':')
      const stepId = edgeKey.slice(0, sepIdx)
      const transIdx = parseInt(edgeKey.slice(sepIdx + 1))
      setFormSteps((prev) =>
        prev.map((s) =>
          s.id === stepId
            ? { ...s, transitions: s.transitions.map((t, i) => (i === transIdx ? { ...t, goto: newTarget } : t)) }
            : s,
        ),
      )
    }
  }, [])

  const handleReconnectFrom = useCallback((edgeKey: string, newSourceId: string) => {
    const sepIdx = edgeKey.lastIndexOf(':')
    const stepId = edgeKey.slice(0, sepIdx)
    const transIdx = parseInt(edgeKey.slice(sepIdx + 1))
    setFormSteps((prev) => {
      const oldStep = prev.find((s) => s.id === stepId)
      if (!oldStep) return prev
      const trans = oldStep.transitions[transIdx]
      if (!trans) return prev
      return prev.map((s) => {
        if (s.id === stepId) return { ...s, transitions: s.transitions.filter((_, i) => i !== transIdx) }
        if (s.id === newSourceId) return { ...s, transitions: [...s.transitions, trans] }
        return s
      })
    })
    setSelectedEdgeKey(null) // edge key changed after move
  }, [])

  const handleDeleteTransition = useCallback((edgeKey: string) => {
    if (edgeKey === 'start') {
      setFormEntryStep('')
    } else {
      const sepIdx = edgeKey.lastIndexOf(':')
      const stepId = edgeKey.slice(0, sepIdx)
      const transIdx = parseInt(edgeKey.slice(sepIdx + 1))
      setFormSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, transitions: s.transitions.filter((_, i) => i !== transIdx) } : s)),
      )
    }
    setSelectedEdgeKey(null)
  }, [])

  const handleUpdateTransitionCondition = useCallback((edgeKey: string, when: { type: string; result?: string }) => {
    if (edgeKey === 'start') {
      setFormStartCondition(when)
    } else {
      const sepIdx = edgeKey.lastIndexOf(':')
      const stepId = edgeKey.slice(0, sepIdx)
      const transIdx = parseInt(edgeKey.slice(sepIdx + 1))
      setFormSteps((prev) =>
        prev.map((s) =>
          s.id === stepId
            ? { ...s, transitions: s.transitions.map((t, i) => (i === transIdx ? { ...t, when } : t)) }
            : s,
        ),
      )
    }
  }, [])

  // Resolve selected edge data for properties panel
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

  // ============================================================================
  // Edit View
  // ============================================================================

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

        {/* Metadata bar */}
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

        {/* Main area: flow + panel */}
        <div className="flex gap-3" style={{ height: 'calc(90vh - 220px)', minHeight: 300 }}>
          {/* Flow diagram */}
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

          {/* Properties panel */}
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
                  /* Start edge / activation condition */
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
                    <p className="text-text-muted text-[10px]">
                      Workflow only proceeds when this condition is met. Drag the target handle to change entry step.
                    </p>
                  </div>
                ) : (
                  /* Step transition */
                  <TransitionPanel
                    fromLabel={edgeInfo.fromLabel}
                    toLabel={edgeInfo.toLabel}
                    condition={edgeInfo.condition}
                    fromStep={edgeInfo.type === 'step' ? formSteps.find((s) => s.id === edgeInfo.fromLabel) : undefined}
                    agentTypes={agentTypes}
                    onUpdateCondition={(when) => handleUpdateTransitionCondition(selectedEdgeKey!, when)}
                    onDelete={() => handleDeleteTransition(selectedEdgeKey!)}
                  />
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

        {/* Footer */}
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
              <Button variant="secondary" onClick={handleSave} disabled={saving || !formName}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="primary" onClick={handleSaveAndClose} disabled={saving || !formName}>
                Save & Close
              </Button>
            </>
          )}
        </div>
      </Modal>
    )
  }

  // ============================================================================
  // List View
  // ============================================================================

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Workflows" size="lg">
      <div className="flex items-center justify-between mb-4">
        <p className="text-text-secondary text-sm">
          Workflows define the orchestrator's step sequence when running tasks.
        </p>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <Button variant="primary" size="sm" onClick={handleNew}>
            + New
          </Button>
        </div>
      </div>

      {loading && defaults.length === 0 && userItems.length === 0 ? (
        <div className="text-text-muted text-sm">Loading workflows...</div>
      ) : defaults.length === 0 && userItems.length === 0 ? (
        <div className="text-text-muted text-sm">No workflows installed.</div>
      ) : (
        <div className="space-y-4">
          {defaults.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">Built-in</h3>
              <div className="space-y-2">
                {defaults.map((workflow) => (
                  <div
                    key={workflow.id}
                    className="flex items-center justify-between p-3 rounded border border-border bg-bg-tertiary"
                  >
                    <div className="min-w-0 flex-1 mr-3">
                      <div className="flex items-center gap-2">
                        <span className="text-text-primary text-sm font-medium">{workflow.name}</span>
                        <span className="text-text-muted text-xs">v{workflow.version}</span>
                      </div>
                      <p className="text-text-secondary text-xs mt-0.5 truncate">{workflow.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleView(workflow.id)}
                        className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-primary transition-colors"
                        title="View"
                      >
                        <EyeIcon />
                      </button>
                      <DuplicateIcon onClick={() => handleDuplicate(workflow.id)} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {userItems.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wide">Custom</h3>
              <div className="space-y-2">
                {userItems.map((workflow) => (
                  <div
                    key={workflow.id}
                    className="flex items-center justify-between p-3 rounded border border-border bg-bg-tertiary"
                  >
                    <div className="min-w-0 flex-1 mr-3">
                      <div className="flex items-center gap-2">
                        <span className="text-text-primary text-sm font-medium">{workflow.name}</span>
                        <span className="text-text-muted text-xs">v{workflow.version}</span>
                      </div>
                      <p className="text-text-secondary text-xs mt-0.5 truncate">{workflow.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <DuplicateIcon onClick={() => handleDuplicate(workflow.id)} />
                      <EditButton onClick={() => handleEdit(workflow.id)} />
                      {isConfirming(workflow.id, 'delete') ? (
                        <ConfirmButton onConfirm={() => handleDelete(workflow.id)} onCancel={() => {}} />
                      ) : (
                        <DeleteIcon onClick={() => requestDelete(workflow.id)} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
