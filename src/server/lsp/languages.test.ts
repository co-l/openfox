import { describe, it, expect } from 'vitest'
import { detectLanguage, getLanguageById, getSupportedLanguages, LANGUAGES } from './languages.js'

describe('detectLanguage', () => {
  describe('TypeScript/JavaScript', () => {
    it('detects .ts files as typescript', () => {
      expect(detectLanguage('src/index.ts')?.id).toBe('typescript')
    })

    it('detects .tsx files as typescript', () => {
      expect(detectLanguage('components/Button.tsx')?.id).toBe('typescript')
    })

    it('detects .js files as typescript', () => {
      expect(detectLanguage('lib/utils.js')?.id).toBe('typescript')
    })

    it('detects .jsx files as typescript', () => {
      expect(detectLanguage('components/App.jsx')?.id).toBe('typescript')
    })

    it('detects .mjs files as typescript', () => {
      expect(detectLanguage('entry.mjs')?.id).toBe('typescript')
    })

    it('detects .cjs files as typescript', () => {
      expect(detectLanguage('config.cjs')?.id).toBe('typescript')
    })
  })

  describe('Python', () => {
    it('detects .py files as python', () => {
      expect(detectLanguage('main.py')?.id).toBe('python')
    })

    it('detects .pyi files as python', () => {
      expect(detectLanguage('stubs/types.pyi')?.id).toBe('python')
    })
  })

  describe('Rust', () => {
    it('detects .rs files as rust', () => {
      expect(detectLanguage('src/main.rs')?.id).toBe('rust')
    })
  })

  describe('Go', () => {
    it('detects .go files as go', () => {
      expect(detectLanguage('cmd/server/main.go')?.id).toBe('go')
    })
  })

  describe('C/C++', () => {
    it('detects .c files as cpp', () => {
      expect(detectLanguage('src/main.c')?.id).toBe('cpp')
    })

    it('detects .cpp files as cpp', () => {
      expect(detectLanguage('src/main.cpp')?.id).toBe('cpp')
    })

    it('detects .h files as cpp', () => {
      expect(detectLanguage('include/header.h')?.id).toBe('cpp')
    })

    it('detects .hpp files as cpp', () => {
      expect(detectLanguage('include/header.hpp')?.id).toBe('cpp')
    })
  })

  describe('Ruby', () => {
    it('detects .rb files as ruby', () => {
      expect(detectLanguage('app/models/user.rb')?.id).toBe('ruby')
    })

    it('detects .rake files as ruby', () => {
      expect(detectLanguage('tasks/deploy.rake')?.id).toBe('ruby')
    })
  })

  describe('Special filenames', () => {
    it('detects Dockerfile as dockerfile', () => {
      expect(detectLanguage('Dockerfile')?.id).toBe('dockerfile')
    })

    it('detects lowercase dockerfile as dockerfile', () => {
      expect(detectLanguage('dockerfile')?.id).toBe('dockerfile')
    })

    it('detects Containerfile as dockerfile', () => {
      expect(detectLanguage('Containerfile')?.id).toBe('dockerfile')
    })
  })

  describe('Configuration files', () => {
    it('detects .yaml files as yaml', () => {
      expect(detectLanguage('config.yaml')?.id).toBe('yaml')
    })

    it('detects .yml files as yaml', () => {
      expect(detectLanguage('docker-compose.yml')?.id).toBe('yaml')
    })

    it('detects .json files as json', () => {
      expect(detectLanguage('package.json')?.id).toBe('json')
    })

    it('detects .toml files as toml', () => {
      expect(detectLanguage('Cargo.toml')?.id).toBe('toml')
    })
  })

  describe('Web files', () => {
    it('detects .html files as html', () => {
      expect(detectLanguage('index.html')?.id).toBe('html')
    })

    it('detects .css files as css', () => {
      expect(detectLanguage('styles.css')?.id).toBe('css')
    })

    it('detects .scss files as css', () => {
      expect(detectLanguage('styles.scss')?.id).toBe('css')
    })

    it('detects .vue files as vue', () => {
      expect(detectLanguage('App.vue')?.id).toBe('vue')
    })

    it('detects .svelte files as svelte', () => {
      expect(detectLanguage('App.svelte')?.id).toBe('svelte')
    })
  })

  describe('Functional languages', () => {
    it('detects .hs files as haskell', () => {
      expect(detectLanguage('Main.hs')?.id).toBe('haskell')
    })

    it('detects .ml files as ocaml', () => {
      expect(detectLanguage('main.ml')?.id).toBe('ocaml')
    })

    it('detects .ex files as elixir', () => {
      expect(detectLanguage('web/router.ex')?.id).toBe('elixir')
    })

    it('detects .elm files as elm', () => {
      expect(detectLanguage('src/Main.elm')?.id).toBe('elm')
    })

    it('detects .clj files as clojure', () => {
      expect(detectLanguage('src/core.clj')?.id).toBe('clojure')
    })
  })

  describe('Modern languages', () => {
    it('detects .zig files as zig', () => {
      expect(detectLanguage('src/main.zig')?.id).toBe('zig')
    })

    it('detects .gleam files as gleam', () => {
      expect(detectLanguage('src/app.gleam')?.id).toBe('gleam')
    })

    it('detects .nix files as nix', () => {
      expect(detectLanguage('flake.nix')?.id).toBe('nix')
    })
  })

  describe('Unknown/unsupported', () => {
    it('returns null for unknown extensions', () => {
      expect(detectLanguage('file.xyz')).toBeNull()
    })

    it('returns null for files without extensions', () => {
      expect(detectLanguage('README')).toBeNull()
    })

    it('returns null for empty path', () => {
      expect(detectLanguage('')).toBeNull()
    })
  })
})

describe('getLanguageById', () => {
  it('returns typescript config for typescript id', () => {
    const lang = getLanguageById('typescript')
    expect(lang).not.toBeNull()
    expect(lang?.id).toBe('typescript')
    expect(lang?.serverCommand).toBe('typescript-language-server')
  })

  it('returns rust config for rust id', () => {
    const lang = getLanguageById('rust')
    expect(lang).not.toBeNull()
    expect(lang?.serverCommand).toBe('rust-analyzer')
  })

  it('returns null for unknown id', () => {
    expect(getLanguageById('unknown-lang')).toBeNull()
  })
})

describe('getSupportedLanguages', () => {
  it('returns all languages', () => {
    const languages = getSupportedLanguages()
    expect(languages.length).toBe(LANGUAGES.length)
  })

  it('includes typescript', () => {
    const languages = getSupportedLanguages()
    expect(languages.some((l) => l.id === 'typescript')).toBe(true)
  })

  it('includes python', () => {
    const languages = getSupportedLanguages()
    expect(languages.some((l) => l.id === 'python')).toBe(true)
  })

  it('returns a copy of the array', () => {
    const languages1 = getSupportedLanguages()
    const languages2 = getSupportedLanguages()
    expect(languages1).not.toBe(languages2)
  })
})

describe('LANGUAGES constant', () => {
  it('has unique ids', () => {
    const ids = LANGUAGES.map((l) => l.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  it('all languages have required fields', () => {
    for (const lang of LANGUAGES) {
      expect(lang.id).toBeTruthy()
      expect(lang.name).toBeTruthy()
      expect(lang.serverCommand).toBeTruthy()
      expect(Array.isArray(lang.extensions)).toBe(true)
      expect(Array.isArray(lang.serverArgs)).toBe(true)
      expect(Array.isArray(lang.rootPatterns)).toBe(true)
    }
  })

  it('has at least 30 supported languages', () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(30)
  })
})
