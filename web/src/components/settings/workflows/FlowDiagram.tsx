import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import type { WorkflowStep } from '../../../stores/workflows'
import type { AgentInfo } from '../../../stores/agents'
import { computeLayout, PORT_R, type LayoutEdge, type LayoutNode, type DragState } from './layout'

interface FlowDiagramProps {
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
}

export function FlowDiagram({
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
}: FlowDiagramProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragEndedRef = useRef(false)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dragHoverTarget, setDragHoverTarget] = useState<string | null>(null)

  const { nodes, edges, width, height, posMap } = useMemo(
    () => computeLayout(steps, entryStep, startConditionLabel, agentTypes),
    [steps, entryStep, startConditionLabel, agentTypes],
  )

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

  const isValidTarget = useCallback(
    (nodeId: string): boolean => {
      if (!nodeId || !dragState) return false
      if (nodeId === '$start') return false
      if (dragState.type === 'reconnect-from') {
        return nodeId !== '$done'
      }
      return true
    },
    [dragState],
  )

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
      path = `M ${x1} ${y1} C ${x1} ${y1 + dy * 0.4}, ${x2 - dx * 0.2} ${y2 - dy * 0.1}, ${x2} ${y2}`
      labelX = x1 + (x2 - x1) * 0.5
      labelY = y1 + dy * 0.6
      fromPt = { x: x1, y: y1 }
      toPt = { x: x2, y: y2 }
    } else if (e.direction === 'back') {
      const isSelf = e.from === e.to
      const routeRight = from.cx >= width / 2
      const offset = e.backEdgeIndex * 16
      const edgeX = routeRight ? width - 20 - offset : 20 + offset

      if (isSelf) {
        const loopRight = from.cx >= width / 2
        const loopOut = 30 + e.backEdgeIndex * 14
        const top = from.cy - from.h / 2
        const side = loopRight ? from.cx + from.w / 2 : from.cx - from.w / 2
        const outX = loopRight ? side + loopOut : side - loopOut
        const enterX = from.cx + (loopRight ? from.w / 4 : -from.w / 4)
        const peakY = top - 20 - e.backEdgeIndex * 10
        path = `M ${side} ${from.cy} C ${outX} ${from.cy}, ${outX} ${peakY}, ${enterX} ${top}`
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
    const showLabel = e.label && e.label !== 'otherwise'

    return (
      <g key={i}>
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

      {edges.map((e, i) => renderEdge(e, i))}

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
            {!isReadOnly && renderOutputPort(node)}
            {!isReadOnly && renderInputPort(node)}
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

      {renderDragLine()}
      {renderEdgeHandles()}
    </svg>
  )
}
