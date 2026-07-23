// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('theme.css fallback variables', () => {
  const cssPath = path.resolve(import.meta.dirname, 'theme.css')
  const cssContent = fs.readFileSync(cssPath, 'utf-8')

  const newVariables = [
    '--color-text-heading',
    '--color-text-bold',
    '--color-text-code',
    '--color-text-link',
    '--color-bg-system',
    '--color-border-system',
    '--color-text-system',
    '--color-text-thinking',
    '--color-text-truncated',
    '--color-text-tool-error',
  ]

  newVariables.forEach((variable) => {
    it(`declares fallback CSS variable ${variable} in :root`, () => {
      expect(cssContent).toContain(variable)
    })
  })
})
