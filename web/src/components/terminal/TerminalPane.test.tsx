import { describe, it, expect, vi } from 'vitest'
import { TerminalPane } from './TerminalPane'

const mockWriteSession = vi.fn()
const mockResizeSession = vi.fn()

vi.mock('../../stores/terminal', () => ({
  useTerminalStore: () => ({
    writeSession: mockWriteSession,
    resizeSession: mockResizeSession,
  }),
}))

vi.mock('../../lib/ws', () => ({
  wsClient: {
    subscribe: vi.fn(() => {
      return vi.fn()
    }),
  },
}))

let mockCols = 80
let mockRows = 24

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    options: any
    element: HTMLElement | null = null
    constructor(options: any) {
      this.options = options
    }
    loadAddon() {}
    open(element: HTMLElement) {
      this.element = element
    }
    onData() {}
    write() {}
    resize(cols: number, rows: number) {
      mockCols = cols
      mockRows = rows
    }
    dispose() {}
    get cols() {
      return mockCols
    }
    get rows() {
      return mockRows
    }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {
    fit() {}
    proposeDimensions() {
      return { cols: mockCols, rows: mockRows }
    }
  },
}))

describe('TerminalPane', () => {
  it('component exists', () => {
    expect(TerminalPane).toBeDefined()
  })
})
