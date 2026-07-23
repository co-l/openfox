// @vitest-environment node
import { describe, it, expect } from 'vitest'
import tailwindConfig from '../tailwind.config'

describe('tailwind.config', () => {
  const colors = tailwindConfig.theme?.extend?.colors as Record<string, unknown>

  it('has bg.system color mapping', () => {
    const bg = colors?.bg as Record<string, unknown>
    expect(bg?.system).toBe('rgb(var(--color-bg-system) / <alpha-value>)')
  })

  it('has border.system color mapping', () => {
    const borderColors = colors as Record<string, unknown>
    const border = borderColors.border
    expect(typeof border).toBe('object')
    expect((border as Record<string, string>).system).toBe('rgb(var(--color-border-system) / <alpha-value>)')
  })

  it('preserves existing border DEFAULT mapping', () => {
    const borderColors = colors as Record<string, unknown>
    const border = borderColors.border
    expect(typeof border).toBe('object')
    expect((border as Record<string, string>).DEFAULT).toBe('rgb(var(--color-border) / <alpha-value>)')
  })

  it('has text theme color mappings for new tokens', () => {
    const text = colors?.text as Record<string, unknown>
    expect(text?.heading).toBe('rgb(var(--color-text-heading) / <alpha-value>)')
    expect(text?.bold).toBe('rgb(var(--color-text-bold) / <alpha-value>)')
    expect(text?.code).toBe('rgb(var(--color-text-code) / <alpha-value>)')
    expect(text?.link).toBe('rgb(var(--color-text-link) / <alpha-value>)')
    expect(text?.system).toBe('rgb(var(--color-text-system) / <alpha-value>)')
    expect(text?.thinking).toBe('rgb(var(--color-text-thinking) / <alpha-value>)')
    expect(text?.truncated).toBe('rgb(var(--color-text-truncated) / <alpha-value>)')
    expect(text?.['tool-error']).toBe('rgb(var(--color-text-tool-error) / <alpha-value>)')
  })
})
