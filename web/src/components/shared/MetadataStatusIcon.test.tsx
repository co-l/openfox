// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetadataStatusIcon, getStatusConfig } from './MetadataStatusIcon'

describe('MetadataStatusIcon', () => {
  it('renders the configured glyph for a known status', () => {
    render(<MetadataStatusIcon status="pending" />)
    expect(screen.getByText('○')).toBeInTheDocument()
  })

  it('marks an unknown status with a glyph distinct from pending', () => {
    render(<MetadataStatusIcon status="done" />)
    expect(screen.getByText('?')).toBeInTheDocument()
    expect(screen.queryByText('○')).not.toBeInTheDocument()
  })

  it('uses a distinct color for an unknown status', () => {
    render(<MetadataStatusIcon status="done" />)
    const el = screen.getByText('?')
    expect(el.className).toContain('text-accent-error')
    expect(el.className).not.toContain('text-text-muted')
  })

  it('getStatusConfig falls back to the unknown-status marker, not the pending marker', () => {
    expect(getStatusConfig('done')).toEqual({ icon: '?', color: 'text-accent-error' })
    expect(getStatusConfig('pending')).toEqual({ icon: '○', color: 'text-text-muted' })
  })
})
