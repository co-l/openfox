import type { WorkflowStep } from '../../../stores/workflows'
import type { AgentInfo } from '../../../stores/agents'

export const NODE_W = 150
export const NODE_H = 54
export const TERM_W = 80
export const TERM_H = 30
export const GAP_Y = 70
export const COL_GAP = 100
export const PAD = 50
export const BACK_MARGIN = 50
export const PORT_R = 4

export const CONDITION_LABELS: Record<string, string> = {
  step_result: 'Result',
  metadata_all_match: 'Metadata match',
  metadata_all_in: 'Metadata in',
  always: 'otherwise',
}

export const CONDITION_TYPES = [
  { value: 'step_result', label: 'Step result is...' },
  { value: 'metadata_all_match', label: 'Metadata all match (key=value)' },
  { value: 'metadata_all_in', label: 'Metadata all in list' },
  { value: 'always', label: 'Always (fallback)' },
] as const

export const STEP_TYPES = [
  { value: 'agent', label: 'Agent' },
  { value: 'sub_agent', label: 'Sub-Agent' },
  { value: 'shell', label: 'Shell' },
] as const

export interface LayoutNode {
  id: string
  type: 'step' | 'terminal'
  label: string
  color?: string
  cx: number
  cy: number
  w: number
  h: number
}

export interface LayoutEdge {
  from: string
  to: string
  label: string
  edgeKey: string
  direction: 'down' | 'back' | 'same'
  backEdgeIndex: number
  sameEdgeIndex: number
  fromPort: number
  toPort: number
}

export interface DragState {
  type: 'new' | 'reconnect-to' | 'reconnect-from'
  fromNodeId: string
  fixedTargetId?: string
  edgeKey?: string
  mouseX: number
  mouseY: number
}

export function resolveAgent(step: WorkflowStep, agentTypes: AgentInfo[]): { name: string; color: string } {
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

export function computeLayout(
  steps: WorkflowStep[],
  entryStep: string,
  startConditionLabel: string,
  agentTypes: AgentInfo[],
) {
  const canvasW = BACK_MARGIN + PAD + NODE_W + COL_GAP + NODE_W + PAD + BACK_MARGIN
  const centerX = canvasW / 2
  const leftColCx = BACK_MARGIN + PAD + NODE_W / 2
  const rightColCx = BACK_MARGIN + PAD + NODE_W + COL_GAP + NODE_W / 2

  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []
  const posMap = new Map<string, { cx: number; cy: number; w: number; h: number }>()

  const leftSteps = steps.filter((s) => s.type === 'agent' || s.type === 'shell')
  const rightSteps = steps.filter((s) => s.type === 'sub_agent')
  const hasRight = rightSteps.length > 0
  const effectiveLeftCx = hasRight ? leftColCx : centerX
  const effectiveRightCx = leftSteps.length > 0 ? rightColCx : centerX

  const startCy = PAD + TERM_H / 2
  nodes.push({ id: '$start', type: 'terminal', label: 'Start', cx: effectiveLeftCx, cy: startCy, w: TERM_W, h: TERM_H })
  posMap.set('$start', { cx: effectiveLeftCx, cy: startCy, w: TERM_W, h: TERM_H })

  const addDoneNode = (cy: number) => {
    nodes.push({ id: '$done', type: 'terminal', label: 'Done', cx: effectiveLeftCx, cy, w: TERM_W, h: TERM_H })
    posMap.set('$done', { cx: effectiveLeftCx, cy, w: TERM_W, h: TERM_H })
  }

  if (steps.length === 0) {
    const bottomY = startCy + TERM_H / 2 + GAP_Y * 2 + TERM_H / 2
    addDoneNode(bottomY)
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

  addDoneNode(bottomY)

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
        t.when.type === 'step_result'
          ? `${t.when.result}`
          : t.when.type === 'metadata_all_match'
            ? `${t.when.key ?? '?'}=${t.when.value ?? '?'}`
            : t.when.type === 'metadata_all_in'
              ? `${t.when.key ?? '?'} in [${t.when.values?.join(',') ?? '?'}]`
              : (CONDITION_LABELS[t.when.type] ?? t.when.type)
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
