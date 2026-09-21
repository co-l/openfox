import { describe, it, expect } from 'vitest'
import { Linter } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import { jsxNoLiterals } from './jsx-no-literals.mjs'

const linter = new Linter()

function lint(code: string) {
  return linter.verify(
    code,
    [
      {
        files: ['**/*.tsx'],
        languageOptions: {
          parser: tsParser,
          parserOptions: { ecmaFeatures: { jsx: true }, ecmaVersion: 'latest', sourceType: 'module' },
        },
        plugins: {
          i18n: {
            rules: {
              'jsx-no-literals': {
                create: jsxNoLiterals({
                  noStrings: true,
                  restrictedAttributes: ['aria-label', 'placeholder', 'title', 'alt'],
                }),
              },
            },
          },
        },
        rules: {
          'i18n/jsx-no-literals': 'error',
        },
      },
    ],
    { filename: 'test.tsx' },
  )
}

describe('jsx-no-literals', () => {
  it('flags raw JSX text', () => {
    const messages = lint(`export const C = () => <div>scroll to bottom</div>`)
    expect(messages).toHaveLength(1)
  })

  it('flags a direct string-literal child', () => {
    const messages = lint(`export const C = () => <div>{'scroll to bottom'}</div>`)
    expect(messages).toHaveLength(1)
  })

  it('flags string literals inside conditional expressions', () => {
    const messages = lint(`export const C = ({ isActive }) => <div>{isActive ? 'live' : 'scroll to bottom'}</div>`)
    expect(messages).toHaveLength(2)
  })

  it('flags string literals inside logical expressions', () => {
    const messages = lint(`export const C = ({ n }) => <div>{n > 0 && 'items'}</div>`)
    expect(messages).toHaveLength(1)
  })

  it('does not flag translated strings passed to t()', () => {
    const messages = lint(`export const C = () => <div>{t({ en: 'live', fr: 'direct' })}</div>`)
    expect(messages).toHaveLength(0)
  })

  it('does not flag string literals in attribute values', () => {
    const messages = lint(`export const C = ({ isActive }) => <div className={isActive ? 'a' : 'b'} />`)
    expect(messages).toHaveLength(0)
  })
})
