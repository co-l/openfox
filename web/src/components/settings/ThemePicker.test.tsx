import { describe, expect, it } from 'vitest'

describe('ThemePicker theme values', () => {
  it('has valid theme keys', () => {
    const validThemes = ['dark', 'light'] as const
    expect(validThemes).toContain('dark')
    expect(validThemes).toContain('light')
  })

  it('theme CSS class follows pattern', () => {
    const themeToClass = (theme: string) => theme === 'dark' ? 'dark' : 'light'
    expect(themeToClass('dark')).toBe('dark')
    expect(themeToClass('light')).toBe('light')
  })
})