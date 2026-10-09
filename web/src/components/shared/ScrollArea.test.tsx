// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_KEYS, settingResource } from '../../lib/resources'
import { clearCache } from '../../lib/resourceCache'
import type { OverlayScrollbarsComponentRef } from 'overlayscrollbars-react'
import { ScrollArea } from './ScrollArea'

type Ref = OverlayScrollbarsComponentRef<'div'>

vi.mock('../../lib/api', () => ({ authFetch: vi.fn() }))

describe('ScrollArea', () => {
  beforeEach(() => {
    clearCache()
  })

  afterEach(cleanup)

  it('delegates to the overlay scrollbars component by default', () => {
    const ref = createRef<Ref>()
    const { container } = render(<ScrollArea ref={ref}>content</ScrollArea>)

    // The test-setup mock renders a plain div whose ref carries the OS
    // instance shape; default mode must forward the ref to it untouched.
    const div = container.querySelector('div')!
    expect(ref.current!.osInstance()!.elements().viewport).toBe(div)
    expect(container.textContent).toContain('content')
  })

  it('mounts a native scrollable div when useNativeScrollbars is enabled', () => {
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS)
    const { container } = render(<ScrollArea>content</ScrollArea>)

    expect(container.querySelector('.os-container')).toBeNull()
    expect(container.querySelector('.overflow-y-auto')).not.toBeNull()
    expect(container.textContent).toContain('content')
  })

  it('maps the horizontal flag to a horizontal native scroller', () => {
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS)
    const { container } = render(<ScrollArea horizontal>content</ScrollArea>)

    expect(container.querySelector('.overflow-x-auto')).not.toBeNull()
  })

  it('exposes the native host element through the ref adapter', () => {
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS)
    const ref = createRef<Ref>()
    render(<ScrollArea ref={ref}>content</ScrollArea>)

    const viewport = ref.current!.osInstance()!.elements().viewport
    expect(viewport).toBe(ref.current!.getElement())
  })
})
