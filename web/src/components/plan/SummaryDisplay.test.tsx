import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SummaryDisplay } from './SummaryDisplay'

describe('SummaryDisplay', () => {
  it('renders summary content when provided', () => {
    const summary = 'This is a test summary of the user request.'
    const html = renderToStaticMarkup(<SummaryDisplay summary={summary} />)
    
    expect(html).toContain(summary)
  })

  it('shows placeholder when summary is null', () => {
    const html = renderToStaticMarkup(<SummaryDisplay summary={null} />)
    
    expect(html).toContain('No summary yet')
  })

  it('shows placeholder when summary is empty string', () => {
    const html = renderToStaticMarkup(<SummaryDisplay summary="" />)
    
    expect(html).toContain('No summary yet')
  })

  it('has correct header with Summary title', () => {
    const html = renderToStaticMarkup(<SummaryDisplay summary="test" />)
    
    expect(html).toContain('Summary')
  })
})
