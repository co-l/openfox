/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest'
import http from 'node:http'
import { PassThrough } from 'node:stream'
import { Socket } from 'node:net'

const origRequest = http.request.bind(http)
http.request = function (this: any, ...args: any[]) {
  const url = typeof args[0] === 'string' ? args[0] : args[0]?.href || ''
  if (typeof url === 'string' && (url.includes('localhost:3000') || url.includes('127.0.0.1:3000'))) {
    const body = JSON.stringify({ value: '' })
    const mockRes = new PassThrough() as any
    mockRes.statusCode = 200
    mockRes.statusMessage = 'OK'
    mockRes.headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }
    mockRes.rawHeaders = ['Content-Type', 'application/json', 'Content-Length', String(Buffer.byteLength(body))]
    mockRes.write(Buffer.from(body))
    mockRes.end()

    const mockReq = new PassThrough() as any
    mockReq.setTimeout = () => mockReq
    mockReq.setSocketKeepAlive = () => {}
    mockReq.socket = new Socket()
    mockReq.destroyed = false
    mockReq.destroy = () => {}
    mockReq.headers = {}
    process.nextTick(() => mockReq.emit('response', mockRes))
    return mockReq
  }
  return (origRequest as any)(...args)
} as any

// Mock wouter router hooks for jsdom (components use useLocation/useRoute)
vi.mock('wouter', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react')
  const mockNavigate = vi.fn()
  return {
    useLocation: () => ['/', mockNavigate],
    useRoute: () => [false, vi.fn()],
    Link: ({ children, ...props }: any) => React.createElement('a', props, children),
    Router: ({ children }: any) => children,
    Switch: ({ children }: any) => children,
    Route: ({ children }: any) => children,
  }
})

// Mock overlayscrollbars-react for jsdom (hooks crash without browser APIs)
vi.mock('overlayscrollbars-react', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react')
  // The mocked component renders a plain div and exposes the OS instance shape
  // (osInstance().elements().viewport) so refs resolved via useViewport point at
  // the actual scrollable element, mirroring the real overlayscrollbars behavior.
  // Hookless component: vi.mock factories run against a separate React copy, so
  // using hooks here trips the "multiple copies of React" guard. It renders a
  // plain div and exposes the OS instance shape (osInstance().elements().viewport)
  // on the forwarded ref, mirroring the real overlayscrollbars behavior.
  const MockOverlayScrollbarsComponent = ({ children, ref, ...divProps }: any) => {
    const attachViewport = (element: any) => {
      if (ref) {
        ref.current = element
          ? {
              osInstance: () => ({
                elements: () => ({ viewport: element }),
              }),
            }
          : null
      }
    }
    return React.createElement('div', { ...divProps, ref: attachViewport }, children)
  }
  MockOverlayScrollbarsComponent.displayName = 'OverlayScrollbarsComponent'

  return {
    OverlayScrollbarsComponent: MockOverlayScrollbarsComponent,
    useOverlayScrollbars: () => [() => {}, () => null],
  }
})

// RTL only auto-cleans up when vitest globals are enabled, which they are not
// here. Without it, a test that leaves a portal/modal mounted leaks its React
// root into the next test — the following test's `document.body.innerHTML = ''`
// detaches those nodes, and React's late portal deletion then throws
// "removeChild: not a child". Unmount every tracked root after each test.
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
afterEach(() => {
  cleanup()
})
