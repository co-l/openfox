// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act, type ReactElement } from 'react'

// React 19 requires this flag before act() can be used (repo convention).
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { BackgroundProcesses } from './BackgroundProcesses'
import { useBackgroundProcessesStore } from '../../stores/background-processes'
import type { BackgroundProcess, LogLine } from '@shared/protocol.js'

interface TestRoot {
  unmount: () => void
}

const roots: TestRoot[] = []

function render(element: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  roots.push(root)
  return { root, container }
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const PROCESS: BackgroundProcess = {
  id: 'proc-1',
  sessionId: 'sess-1',
  name: 'dev-server',
  command: 'npm run dev',
  cwd: '/project',
  pid: 4321,
  status: 'running',
  exitCode: null,
  createdAt: Date.now(),
  startedAt: Date.now(),
  endedAt: null,
}

const LOGS: LogLine[] = [{ offset: 0, content: 'hello', timestamp: 1, stream: 'stdout' }]

beforeEach(() => {
  useBackgroundProcessesStore.setState({ processes: [PROCESS], logs: { 'proc-1': LOGS } })
})

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
  }
  act(() => {
    useBackgroundProcessesStore.setState({ processes: [], logs: {} })
  })
  document.body.innerHTML = ''
})

describe('BackgroundProcesses', () => {
  it('shows existing logs when expanding a process', () => {
    render(<BackgroundProcesses sessionId="sess-1" />)

    act(() => {
      ;[...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Logs')?.click()
    })

    expect(document.body.textContent).toContain('hello')
  })

  it('streams new log chunks into the open log viewer without reopening', async () => {
    render(<BackgroundProcesses sessionId="sess-1" />)

    act(() => {
      ;[...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Logs')?.click()
    })

    await act(async () => {
      useBackgroundProcessesStore.getState().handleMessage('backgroundProcess.output', {
        processId: 'proc-1',
        stream: 'stdout',
        content: 'world',
      })
      await nextFrame()
    })

    expect(document.body.textContent).toContain('world')
  })
})
