const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const

export interface SparklinePoint {
  x: number
  y: number
}

export interface SparklineChartData {
  blocks: string
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function normalizeToBlock(value: number, min: number, max: number): number {
  if (max === min) return 4
  const normalized = (value - min) / (max - min)
  return Math.min(7, Math.max(0, Math.round(normalized * 7)))
}

function padYRange(minY: number, maxY: number): { minY: number; maxY: number } {
  if (minY === maxY) {
    const padding = Math.max(Math.abs(minY) * 0.05, 1)
    return { minY: minY - padding, maxY: maxY + padding }
  }

  const range = maxY - minY
  const padding = Math.max(range * 0.1, 0.1)
  return { minY: minY - padding, maxY: maxY + padding }
}

export function buildSparklineChart(data: SparklinePoint[], width: number): SparklineChartData {
  if (data.length === 0 || width <= 0) {
    return { blocks: '', minX: 0, maxX: 0, minY: 0, maxY: 0 }
  }

  const sorted = [...data].sort((a, b) => a.x - b.x)
  const minX = sorted[0]!.x
  const maxX = sorted[sorted.length - 1]!.x
  const rawMinY = Math.min(...sorted.map((point) => point.y))
  const rawMaxY = Math.max(...sorted.map((point) => point.y))
  const { minY, maxY } = padYRange(rawMinY, rawMaxY)

  const columns = Array.from({ length: width }, () => ' ')
  const columnValues = new Map<number, number[]>()

  for (const point of sorted) {
    const column = maxX === minX ? 0 : Math.round(((point.x - minX) / (maxX - minX)) * (width - 1))
    const existing = columnValues.get(column) ?? []
    columnValues.set(column, [...existing, point.y])
  }

  for (const [column, values] of columnValues) {
    const maxValue = Math.max(...values)
    columns[column] = BLOCKS[normalizeToBlock(maxValue, minY, maxY)] ?? BLOCKS[0]
  }

  return {
    blocks: columns.join(''),
    minX,
    maxX,
    minY,
    maxY,
  }
}
