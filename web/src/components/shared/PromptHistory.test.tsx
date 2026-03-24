import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PromptHistoryList } from './PromptHistory'
import type { PromptHistoryItem } from '../../hooks/usePromptHistory'

describe('PromptHistoryList', () => {
  const mockHistory: PromptHistoryItem[] = [
    {
      id: 'msg1',
      content: 'This is a very long prompt that should be trimmed to 150 characters maximum and show an ellipsis at the end',
      timestamp: '2026-03-24T16:30:00Z',
      formattedTimestamp: '2026/03/24 16:30',
      trimmedContent: 'This is a very long prompt that should be trimmed to 150 characters maximum and show an ellipsis at the end...',
      sessionName: 'This session',
    },
    {
      id: 'msg2',
      content: 'Short prompt',
      timestamp: '2026-03-24T14:15:00Z',
      formattedTimestamp: '2026/03/24 14:15',
      trimmedContent: 'Short prompt',
      sessionName: 'Project Planning Session',
    },
    {
      id: 'msg3',
      content: 'Another prompt for testing purposes',
      timestamp: '2026-03-24T10:00:00Z',
      formattedTimestamp: '2026/03/24 10:00',
      trimmedContent: 'Another prompt for testing purposes',
      sessionName: 'Debugging Session',
    },
  ]

  const defaultProps = {
    history: mockHistory,
    selectedIndex: 0,
    onSelect: vi.fn(),
    onEscape: vi.fn(),
    onNavigate: vi.fn(),
  }

  it('renders the prompt history list with timestamps', () => {
    const html = renderToStaticMarkup(<PromptHistoryList {...defaultProps} />)
    
    // Most recent should be at the bottom (last in the list)
    expect(html).toContain('2026/03/24 16:30')
    expect(html).toContain('2026/03/24 14:15')
    expect(html).toContain('2026/03/24 10:00')
  })

  it('displays session names with separator after timestamp', () => {
    const html = renderToStaticMarkup(<PromptHistoryList {...defaultProps} />)
    
    // Check for the format: "date | <span>session name</span>"
    expect(html).toMatch(/2026\/03\/24 16:30 \| <span[^>]*>This session<\/span>/)
    expect(html).toMatch(/2026\/03\/24 14:15 \| <span[^>]*>Project Planning Session<\/span>/)
    expect(html).toMatch(/2026\/03\/24 10:00 \| <span[^>]*>Debugging Session<\/span>/)
  })

  it('does not show separator lines between entries', () => {
    const html = renderToStaticMarkup(<PromptHistoryList {...defaultProps} />)
    
    // No separator lines should be present
    expect(html).not.toContain('-------')
  })

  it('displays trimmed content for long prompts', () => {
    const html = renderToStaticMarkup(<PromptHistoryList {...defaultProps} />)
    
    expect(html).toContain('This is a very long prompt')
    expect(html).toContain('...')
  })

  it('highlights the selected item with background class', () => {
    const html = renderToStaticMarkup(<PromptHistoryList {...defaultProps} />)
    
    // The first item should have the selected class
    expect(html).toContain('bg-accent-primary/20')
    expect(html).toContain('border-accent-primary')
  })

  it('renders with correct role attributes', () => {
    const html = renderToStaticMarkup(<PromptHistoryList {...defaultProps} />)
    
    expect(html).toContain('role="list"')
    expect(html).toContain('role="listitem"')
  })

  it('renders all provided history items', () => {
    const manyHistory: PromptHistoryItem[] = Array.from({ length: 15 }, (_, i) => ({
      id: `msg${i}`,
      content: `Prompt ${i}`,
      timestamp: `2026-03-24T${String(10 + i).padStart(2, '0')}:00:00Z`,
      formattedTimestamp: `2026/03/24 ${String(10 + i).padStart(2, '0')}:00`,
      trimmedContent: `Prompt ${i}`,
      sessionName: i % 2 === 0 ? 'Session A' : 'Session B',
    }))
    
    const html = renderToStaticMarkup(<PromptHistoryList 
      history={manyHistory}
      selectedIndex={0}
      onSelect={vi.fn()}
      onEscape={vi.fn()}
      onNavigate={vi.fn()}
    />)
    
    // Component renders all provided items (limiting is done in the hook)
    const promptCount = (html.match(/Prompt \d+/g) || []).length
    expect(promptCount).toBe(15)
  })
})
