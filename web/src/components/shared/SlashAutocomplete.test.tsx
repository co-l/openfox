// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { SlashAutocomplete, type SkillSlashInfo } from './SlashAutocomplete'
import { SETTINGS_KEYS } from '../../lib/resources'
import { setLocale } from '@shared/i18n/index.js'
import type { WorkflowInfo } from '../../lib/parse-slash-command'
import type { CommandInfo } from '../../lib/parse-slash-command'

const mockSettings: Record<string, string> = {}

vi.mock('../../hooks/useSetting', () => ({
  useSetting: (key: string, fallback = '') => ({ value: mockSettings[key] ?? fallback, loading: false }),
}))

const workflows: WorkflowInfo[] = [
  {
    id: 'review',
    name: 'PR Review',
    scope: 'user',
    parameters: [{ id: 'pr_number', label: 'PR Number', position: 0 }],
  },
  { id: 'review', name: 'PR Review', scope: 'project' },
  { id: 'deploy', name: 'Deploy', scope: 'builtin' },
]

const commands: CommandInfo[] = [
  { id: 'summarize', name: 'Summarize' },
  { id: 'greet', name: 'Greet' },
]

const skills: SkillSlashInfo[] = [
  { id: 'caveman', name: 'Caveman Mode', description: 'Terse communication style' },
  { id: 'browser', name: 'Browser Skill' },
]

function renderAutocomplete(
  text: string,
  cursorPos: number,
  overrides: { workflows?: WorkflowInfo[]; commands?: CommandInfo[]; skills?: SkillSlashInfo[] } = {},
) {
  return render(
    <SlashAutocomplete
      text={text}
      cursorPos={cursorPos}
      workflows={overrides.workflows ?? workflows}
      commands={overrides.commands ?? commands}
      skills={overrides.skills ?? skills}
      onSelect={vi.fn()}
    />,
  )
}

describe('SlashAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(mockSettings).forEach((k) => delete mockSettings[k])
    setLocale('en')
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nothing when no slash at cursor', () => {
    const { container } = renderAutocomplete('hello', 5)
    expect(container.innerHTML).toBe('')
  })

  it('renders matching workflows and commands', () => {
    renderAutocomplete('/rev', 4)
    expect(screen.getAllByText('/review')).toHaveLength(2)
    expect(screen.getAllByText('PR Review')).toHaveLength(2)
    // Should not show non-matching items
    expect(screen.queryByText('/deploy')).toBeNull()
    expect(screen.queryByText('/summarize')).toBeNull()
  })

  it('shows a scope badge for every workflow entry', () => {
    renderAutocomplete('/rev', 4)
    expect(screen.getByText('Global')).toBeDefined()
    expect(screen.getByText('Project')).toBeDefined()
  })

  it('does not tag command entries with a scope badge', () => {
    renderAutocomplete('/sum', 4)
    expect(screen.queryByText('Global')).toBeNull()
    expect(screen.queryByText('Project')).toBeNull()
  })

  it('shows param count badge for parameterized items in English', () => {
    const { container } = renderAutocomplete('/rev', 4)
    const badges = container.querySelectorAll('[class*="rounded"]')
    const paramBadge = Array.from(badges).find((b) => b.textContent?.includes('1 param'))
    expect(paramBadge).toBeDefined()
  })

  it('shows param count badge for parameterized items in French', () => {
    setLocale('fr')
    const { container } = renderAutocomplete('/rev', 4)
    const badges = container.querySelectorAll('[class*="rounded"]')
    const paramBadge = Array.from(badges).find((b) => b.textContent?.includes('1 paramètre'))
    expect(paramBadge).toBeDefined()
  })

  it('matches by name too', () => {
    renderAutocomplete('/dep', 4)
    expect(screen.getByText('/deploy')).toBeDefined()
  })

  it('matches commands', () => {
    renderAutocomplete('/sum', 4)
    expect(screen.getByText('/summarize')).toBeDefined()
  })

  it('matches skills and renders with text-accent-success and Skill badge in English', () => {
    renderAutocomplete('/cave', 5)
    const cmdLabel = screen.getByText('/caveman')
    expect(cmdLabel).toBeDefined()
    expect(cmdLabel.className).toContain('text-accent-success')
    expect(screen.getByText('Caveman Mode')).toBeDefined()
    expect(screen.getByText('Skill')).toBeDefined()
  })

  it('matches skills and renders with Compétence badge in French', () => {
    setLocale('fr')
    renderAutocomplete('/cave', 5)
    const cmdLabel = screen.getByText('/caveman')
    expect(cmdLabel).toBeDefined()
    expect(cmdLabel.className).toContain('text-accent-success')
    expect(screen.getByText('Caveman Mode')).toBeDefined()
    expect(screen.getByText('Compétence')).toBeDefined()
  })

  it('matches skills by description', () => {
    renderAutocomplete('/terse', 6)
    expect(screen.getByText('/caveman')).toBeDefined()
  })

  it('carries the scope on selected workflow suggestions', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <SlashAutocomplete
        text="/rev"
        cursorPos={4}
        workflows={[{ id: 'review', name: 'PR Review', scope: 'project' }]}
        commands={[]}
        onSelect={onSelect}
      />,
    )
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    fireEvent.click(buttons[0]!)
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'review', type: 'workflow', scope: 'project' }),
      0,
    )
  })

  it('renders fullscreen sizing 10px under header when DISPLAY_FULLSCREEN_SLASH_COMMAND is true', () => {
    mockSettings[SETTINGS_KEYS.DISPLAY_FULLSCREEN_SLASH_COMMAND] = 'true'

    const { container } = renderAutocomplete('/rev', 4)
    const listbox = container.querySelector('[role="listbox"]') as HTMLElement
    expect(listbox).toBeTruthy()
    expect(listbox.style.top).toBe('42px')
    expect(listbox.style.bottom).toBe('84px')
    const scrollArea = listbox.querySelector('[class*="bg-bg-secondary"]')
    expect(scrollArea).toBeTruthy()
  })

  it('renders into a portal with fixed positioning when an anchorRef is given', () => {
    const origHeight = window.innerHeight
    const origWidth = window.innerWidth
    Object.defineProperty(window, 'innerHeight', { value: 540, configurable: true })
    Object.defineProperty(window, 'innerWidth', { value: 840, configurable: true })

    const anchor = document.createElement('div')
    Object.defineProperty(anchor, 'getBoundingClientRect', {
      value: () => ({
        top: 76,
        bottom: 132,
        left: 22,
        right: 382,
        width: 290,
        height: 52,
        x: 22,
        y: 78,
        toJSON: () => ({}),
      }),
    })
    document.body.appendChild(anchor)

    try {
      const { unmount } = render(
        <SlashAutocomplete
          text="/rev"
          cursorPos={4}
          workflows={workflows}
          commands={commands}
          onSelect={vi.fn()}
          anchorRef={{ current: anchor }}
        />,
      )
      const listbox = document.body.querySelector('[role="listbox"]')
      expect(listbox).toBeTruthy()
      // Portaled out of the rendering tree: the anchor must not contain it.
      expect(anchor.querySelector('[role="listbox"]')).toBeNull()
      const el = listbox as HTMLElement
      // Position is applied via utility classes; top/left/width are inline.
      expect(el.className).toContain('fixed')
      expect(el.className).toContain('z-[100]')
      expect(el.style.top).toBe('136px') // anchor.bottom + margin
      expect(el.style.left).toBe('22px') // aligned to the anchor
      expect(el.style.width).toBe('290px') // matches the anchor width
      unmount()
    } finally {
      document.body.removeChild(anchor)
      Object.defineProperty(window, 'innerHeight', { value: origHeight, configurable: true })
      Object.defineProperty(window, 'innerWidth', { value: origWidth, configurable: true })
    }
  })

  it('repositions the portaled panel when the anchor moves and a resize fires', async () => {
    const origHeight = window.innerHeight
    const origWidth = window.innerWidth
    Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true })
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })

    let anchorRect = { top: 112, bottom: 168, left: 33, width: 260, height: 56 }
    const anchor = document.createElement('div')
    Object.defineProperty(anchor, 'getBoundingClientRect', { value: () => anchorRect })
    document.body.appendChild(anchor)

    try {
      const { unmount } = render(
        <SlashAutocomplete
          text="/rev"
          cursorPos={4}
          workflows={workflows}
          commands={commands}
          onSelect={vi.fn()}
          anchorRef={{ current: anchor }}
        />,
      )
      const listbox = document.body.querySelector('[role="listbox"]') as HTMLElement
      expect(listbox.style.top).toBe('172px') // anchor.bottom + margin

      // Anchor moves down without scrolling the window; a resize must
      // re-anchor the panel (the same scheduler drives ResizeObserver).
      anchorRect = { top: 312, bottom: 368, left: 33, width: 260, height: 56 }
      window.dispatchEvent(new Event('resize'))
      await waitFor(() => expect(listbox.style.top).toBe('372px'))
      unmount()
    } finally {
      document.body.removeChild(anchor)
      Object.defineProperty(window, 'innerHeight', { value: origHeight, configurable: true })
      Object.defineProperty(window, 'innerWidth', { value: origWidth, configurable: true })
    }
  })
})
