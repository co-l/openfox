// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_KEYS, settingResource } from '../../lib/resources'
import { clearCache } from '../../lib/resourceCache'
import { OptionalScrollArea } from './OptionalScrollArea'

vi.mock('../../lib/api', () => ({ authFetch: vi.fn() }))

describe('OptionalScrollArea', () => {
  beforeEach(() => {
    clearCache()
  })

  afterEach(cleanup)

  it('renders the styled ScrollArea by default (both scopes off)', () => {
    const { container } = render(<OptionalScrollArea>content</OptionalScrollArea>)

    expect(container.textContent).toContain('content')
    expect(container.querySelector('[class*="overflow-"]')).toBeNull()
  })

  it('renders a native scrollable div when the toolCalls scope is enabled', () => {
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS)
    const { container } = render(<OptionalScrollArea>content</OptionalScrollArea>)

    expect(container.querySelector('.overflow-y-auto')).not.toBeNull()
  })

  it('maps the horizontal flag to overflow-x-auto in native mode', () => {
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS)
    const { container } = render(<OptionalScrollArea horizontal>content</OptionalScrollArea>)

    expect(container.querySelector('.overflow-x-auto')).not.toBeNull()
  })

  it('passes through className and style in native mode', () => {
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS)
    const { container } = render(
      <OptionalScrollArea className="max-h-32" style={{ color: 'red' }}>
        content
      </OptionalScrollArea>,
    )

    const div = container.querySelector('.overflow-y-auto')
    expect(div?.className).toContain('max-h-32')
    expect((div as HTMLElement | null)?.style.color).toBe('red')
  })

  it('keeps scopes independent: codeBlocks on does not affect toolCalls', () => {
    settingResource.write('true', SETTINGS_KEYS.DISPLAY_USE_NATIVE_SCROLLBARS_CODE_BLOCKS)
    const { container } = render(
      <div>
        <OptionalScrollArea>tool calls</OptionalScrollArea>
        <OptionalScrollArea scope="codeBlocks">code blocks</OptionalScrollArea>
      </div>,
    )

    const natives = container.querySelectorAll('[class*="overflow-"]')
    expect(natives.length).toBe(1)
    expect(natives[0]?.textContent).toBe('code blocks')
  })
})
