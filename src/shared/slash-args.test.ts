import { describe, it, expect } from 'vitest'
import {
  ARGUMENTS_PARAM,
  applyTemplateParams,
  expandCommandPrompt,
  extractTemplateParams,
  parseSlashInput,
  positionalTemplateParams,
  resolveTemplateParams,
  templateParamHints,
  tokenizeArgs,
} from './slash-args.js'

describe('tokenizeArgs', () => {
  it('splits on whitespace', () => {
    expect(tokenizeArgs('crash src/a.ts')).toEqual(['crash', 'src/a.ts'])
  })

  it('collapses runs of whitespace', () => {
    expect(tokenizeArgs('  a   b  ')).toEqual(['a', 'b'])
  })

  it('returns nothing for an empty line', () => {
    expect(tokenizeArgs('')).toEqual([])
    expect(tokenizeArgs('   ')).toEqual([])
  })

  it('keeps a double-quoted run as one token and strips the quotes', () => {
    expect(tokenizeArgs('foo.ts "gestion des erreurs"')).toEqual(['foo.ts', 'gestion des erreurs'])
  })

  it('keeps a single-quoted run as one token', () => {
    expect(tokenizeArgs("'two words' tail")).toEqual(['two words', 'tail'])
  })

  it('treats the other quote character as literal inside a quoted run', () => {
    expect(tokenizeArgs(`"it's fine"`)).toEqual(["it's fine"])
    expect(tokenizeArgs(`'say "hi"'`)).toEqual(['say "hi"'])
  })

  it('honours backslash escapes inside double quotes only', () => {
    expect(tokenizeArgs('"a \\"quoted\\" word"')).toEqual(['a "quoted" word'])
    expect(tokenizeArgs("'a \\ b'")).toEqual(['a \\ b'])
  })

  it('joins quoted and unquoted fragments that touch', () => {
    expect(tokenizeArgs('src/"my file".ts')).toEqual(['src/my file.ts'])
  })

  it('swallows the rest of the line on an unterminated quote', () => {
    expect(tokenizeArgs('a "unterminated rest')).toEqual(['a', 'unterminated rest'])
  })

  it('preserves an empty quoted argument', () => {
    expect(tokenizeArgs('a "" b')).toEqual(['a', '', 'b'])
  })
})

describe('parseSlashInput', () => {
  it('returns null for non-slash prompts', () => {
    expect(parseSlashInput('just some text')).toBeNull()
    expect(parseSlashInput('')).toBeNull()
    expect(parseSlashInput('   ')).toBeNull()
  })

  it('treats a lone slash as invalid', () => {
    expect(parseSlashInput('/')).toBeNull()
    expect(parseSlashInput('/ ')).toBeNull()
  })

  it('parses a bare id with no args', () => {
    expect(parseSlashInput('/lint')).toEqual({ id: 'lint', args: [], rest: '' })
  })

  it('parses args and keeps the raw remainder', () => {
    expect(parseSlashInput('  /fixme crash src/a.ts  ')).toEqual({
      id: 'fixme',
      args: ['crash', 'src/a.ts'],
      rest: 'crash src/a.ts',
    })
  })

  it('keeps quotes in the raw remainder but strips them from tokens', () => {
    expect(parseSlashInput('/revue foo.ts "gestion des erreurs"')).toEqual({
      id: 'revue',
      args: ['foo.ts', 'gestion des erreurs'],
      rest: 'foo.ts "gestion des erreurs"',
    })
  })

  it('keeps slashes inside args (e.g. file paths)', () => {
    expect(parseSlashInput('/run vitest run src/x.test.ts')?.args).toEqual(['vitest', 'run', 'src/x.test.ts'])
  })
})

describe('extractTemplateParams', () => {
  it('returns placeholders in order of first occurrence, deduplicated', () => {
    expect(extractTemplateParams('{{b}} then {{a}} then {{b}}')).toEqual(['b', 'a'])
  })

  it('returns nothing when there are no placeholders', () => {
    expect(extractTemplateParams('plain prompt')).toEqual([])
  })
})

describe('positionalTemplateParams', () => {
  it('excludes the whole-line placeholder', () => {
    expect(positionalTemplateParams('{{file}} — {{ARGUMENTS}}')).toEqual(['file'])
  })

  it('does not treat a lowercase lookalike as special', () => {
    expect(positionalTemplateParams('{{arguments}}')).toEqual(['arguments'])
  })
})

describe('templateParamHints', () => {
  it('keeps positional order and moves ARGUMENTS last', () => {
    expect(templateParamHints('{{ARGUMENTS}} after {{file}} and {{angle}}')).toEqual(['file', 'angle', ARGUMENTS_PARAM])
  })

  it('omits ARGUMENTS when the template does not use it', () => {
    expect(templateParamHints('{{a}} {{b}}')).toEqual(['a', 'b'])
  })
})

describe('resolveTemplateParams', () => {
  it('fills positional placeholders in order of appearance', () => {
    const { params, unfilledParams } = resolveTemplateParams('Fix {{issue}} in {{file}}', ['crash', 'a.ts'])
    expect(params).toEqual({ issue: 'crash', file: 'a.ts' })
    expect(unfilledParams).toEqual([])
  })

  it('reports placeholders with nothing to fill them', () => {
    const { params, unfilledParams } = resolveTemplateParams('Fix {{issue}} in {{file}}', ['crash'])
    expect(params).toEqual({ issue: 'crash' })
    expect(unfilledParams).toEqual(['file'])
  })

  it('gives ARGUMENTS the raw remainder without consuming a positional slot', () => {
    const { params, unfilledParams } = resolveTemplateParams(
      'Review {{file}}: {{ARGUMENTS}}',
      ['a.ts', 'be', 'harsh'],
      'a.ts be harsh',
    )
    expect(params).toEqual({ file: 'a.ts', [ARGUMENTS_PARAM]: 'a.ts be harsh' })
    expect(unfilledParams).toEqual([])
  })

  it('reports ARGUMENTS as unfilled when nothing was typed after the id', () => {
    const { params, unfilledParams } = resolveTemplateParams('Do {{ARGUMENTS}}', [], '')
    expect(params).toEqual({})
    expect(unfilledParams).toEqual([ARGUMENTS_PARAM])
  })

  it('maps positionally as before when no ARGUMENTS placeholder is present', () => {
    const { params } = resolveTemplateParams('{{a}} {{b}}', ['1', '2'], '1 2')
    expect(params).toEqual({ a: '1', b: '2' })
  })
})

describe('applyTemplateParams', () => {
  it('replaces every occurrence of each placeholder', () => {
    expect(applyTemplateParams('{{a}} and {{a}} and {{b}}', { a: 'x', b: 'y' })).toBe('x and x and y')
  })

  it('leaves placeholders without a value untouched', () => {
    expect(applyTemplateParams('{{a}} {{b}}', { a: 'x' })).toBe('x {{b}}')
  })
})

describe('expandCommandPrompt', () => {
  it('expands a multi-word quoted argument into one placeholder', () => {
    const input = parseSlashInput('/revue foo.ts "gestion des erreurs"')!
    const { prompt, unfilledParams } = expandCommandPrompt(
      'Relis {{fichier}} en te concentrant sur {{angle}}.',
      input.args,
      input.rest,
    )
    expect(prompt).toBe('Relis foo.ts en te concentrant sur gestion des erreurs.')
    expect(unfilledParams).toEqual([])
  })

  it('expands ARGUMENTS with everything typed after the id', () => {
    const input = parseSlashInput('/note remember to rerun the flaky test')!
    const { prompt, unfilledParams } = expandCommandPrompt('Add a note: {{ARGUMENTS}}', input.args, input.rest)
    expect(prompt).toBe('Add a note: remember to rerun the flaky test')
    expect(unfilledParams).toEqual([])
  })

  it('leaves an unfilled placeholder in place and reports it', () => {
    const { prompt, unfilledParams } = expandCommandPrompt('Fix {{issue}} in {{file}}', ['crash'], 'crash')
    expect(prompt).toBe('Fix crash in {{file}}')
    expect(unfilledParams).toEqual(['file'])
  })

  it('works with no arguments at all', () => {
    expect(expandCommandPrompt('plain prompt', [], '')).toEqual({ prompt: 'plain prompt', unfilledParams: [] })
  })
})
