import { extname, basename } from 'node:path'
import type { LanguageConfig } from './types.js'

// ============================================================================
// Supported Language Servers
// ============================================================================

export const LANGUAGES: LanguageConfig[] = [
  // JavaScript/TypeScript ecosystem
  {
    id: 'typescript',
    name: 'TypeScript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    serverCommand: 'typescript-language-server',
    serverArgs: ['--stdio'],
    rootPatterns: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    languageIds: {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
    },
  },

  // Python
  {
    id: 'python',
    name: 'Python',
    extensions: ['.py', '.pyi', '.pyw'],
    serverCommand: 'pyright-langserver',
    serverArgs: ['--stdio'],
    rootPatterns: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'],
  },

  // Rust
  {
    id: 'rust',
    name: 'Rust',
    extensions: ['.rs'],
    serverCommand: 'rust-analyzer',
    serverArgs: [],
    rootPatterns: ['Cargo.toml'],
  },

  // Go
  {
    id: 'go',
    name: 'Go',
    extensions: ['.go'],
    serverCommand: 'gopls',
    serverArgs: ['serve'],
    rootPatterns: ['go.mod', 'go.sum'],
  },

  // C/C++
  {
    id: 'cpp',
    name: 'C/C++',
    extensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx', '.hh'],
    serverCommand: 'clangd',
    serverArgs: ['--background-index'],
    rootPatterns: ['compile_commands.json', 'CMakeLists.txt', '.clangd', 'Makefile'],
  },

  // Zig
  {
    id: 'zig',
    name: 'Zig',
    extensions: ['.zig'],
    serverCommand: 'zls',
    serverArgs: [],
    rootPatterns: ['build.zig', 'build.zig.zon'],
  },

  // Lua
  {
    id: 'lua',
    name: 'Lua',
    extensions: ['.lua'],
    serverCommand: 'lua-language-server',
    serverArgs: [],
    rootPatterns: ['.luarc.json', '.luarc.jsonc', '.luacheckrc'],
  },

  // Ruby
  {
    id: 'ruby',
    name: 'Ruby',
    extensions: ['.rb', '.rake', '.gemspec'],
    serverCommand: 'solargraph',
    serverArgs: ['stdio'],
    rootPatterns: ['Gemfile', '.ruby-version'],
  },

  // Elixir
  {
    id: 'elixir',
    name: 'Elixir',
    extensions: ['.ex', '.exs'],
    serverCommand: 'elixir-ls',
    serverArgs: [],
    rootPatterns: ['mix.exs'],
  },

  // Haskell
  {
    id: 'haskell',
    name: 'Haskell',
    extensions: ['.hs', '.lhs'],
    serverCommand: 'haskell-language-server-wrapper',
    serverArgs: ['--lsp'],
    rootPatterns: ['stack.yaml', 'cabal.project', '*.cabal'],
  },

  // OCaml
  {
    id: 'ocaml',
    name: 'OCaml',
    extensions: ['.ml', '.mli'],
    serverCommand: 'ocamllsp',
    serverArgs: [],
    rootPatterns: ['dune-project', 'dune', '*.opam'],
  },

  // Scala
  {
    id: 'scala',
    name: 'Scala',
    extensions: ['.scala', '.sc'],
    serverCommand: 'metals',
    serverArgs: [],
    rootPatterns: ['build.sbt', 'build.sc', '.metals'],
  },

  // Kotlin
  {
    id: 'kotlin',
    name: 'Kotlin',
    extensions: ['.kt', '.kts'],
    serverCommand: 'kotlin-language-server',
    serverArgs: [],
    rootPatterns: ['build.gradle.kts', 'build.gradle', 'settings.gradle.kts'],
  },

  // Java
  {
    id: 'java',
    name: 'Java',
    extensions: ['.java'],
    serverCommand: 'jdtls',
    serverArgs: [],
    rootPatterns: ['pom.xml', 'build.gradle', '.project'],
  },

  // C#
  {
    id: 'csharp',
    name: 'C#',
    extensions: ['.cs', '.csx'],
    serverCommand: 'OmniSharp',
    serverArgs: ['-lsp'],
    rootPatterns: ['*.csproj', '*.sln'],
  },

  // Swift
  {
    id: 'swift',
    name: 'Swift',
    extensions: ['.swift'],
    serverCommand: 'sourcekit-lsp',
    serverArgs: [],
    rootPatterns: ['Package.swift', '*.xcodeproj', '*.xcworkspace'],
  },

  // PHP
  {
    id: 'php',
    name: 'PHP',
    extensions: ['.php', '.phtml'],
    serverCommand: 'phpactor',
    serverArgs: ['language-server'],
    rootPatterns: ['composer.json', 'phpunit.xml'],
  },

  // YAML
  {
    id: 'yaml',
    name: 'YAML',
    extensions: ['.yaml', '.yml'],
    serverCommand: 'yaml-language-server',
    serverArgs: ['--stdio'],
    rootPatterns: [],
  },

  // JSON
  {
    id: 'json',
    name: 'JSON',
    extensions: ['.json', '.jsonc'],
    serverCommand: 'vscode-json-language-server',
    serverArgs: ['--stdio'],
    rootPatterns: [],
  },

  // HTML
  {
    id: 'html',
    name: 'HTML',
    extensions: ['.html', '.htm', '.xhtml'],
    serverCommand: 'vscode-html-language-server',
    serverArgs: ['--stdio'],
    rootPatterns: [],
  },

  // CSS
  {
    id: 'css',
    name: 'CSS',
    extensions: ['.css', '.scss', '.sass', '.less'],
    serverCommand: 'vscode-css-language-server',
    serverArgs: ['--stdio'],
    rootPatterns: [],
  },

  // Vue
  {
    id: 'vue',
    name: 'Vue',
    extensions: ['.vue'],
    serverCommand: 'vue-language-server',
    serverArgs: ['--stdio'],
    rootPatterns: ['vite.config.ts', 'vite.config.js', 'vue.config.js'],
  },

  // Svelte
  {
    id: 'svelte',
    name: 'Svelte',
    extensions: ['.svelte'],
    serverCommand: 'svelteserver',
    serverArgs: ['--stdio'],
    rootPatterns: ['svelte.config.js', 'svelte.config.ts'],
  },

  // Terraform
  {
    id: 'terraform',
    name: 'Terraform',
    extensions: ['.tf', '.tfvars'],
    serverCommand: 'terraform-ls',
    serverArgs: ['serve'],
    rootPatterns: ['.terraform', 'main.tf'],
  },

  // Dockerfile
  {
    id: 'dockerfile',
    name: 'Docker',
    extensions: [], // Uses filename matching
    serverCommand: 'docker-langserver',
    serverArgs: ['--stdio'],
    rootPatterns: ['Dockerfile', 'docker-compose.yml'],
  },

  // Bash/Shell
  {
    id: 'bash',
    name: 'Bash',
    extensions: ['.sh', '.bash', '.zsh'],
    serverCommand: 'bash-language-server',
    serverArgs: ['start'],
    rootPatterns: [],
  },

  // SQL
  {
    id: 'sql',
    name: 'SQL',
    extensions: ['.sql'],
    serverCommand: 'sql-language-server',
    serverArgs: ['up', '--method', 'stdio'],
    rootPatterns: [],
  },

  // GraphQL
  {
    id: 'graphql',
    name: 'GraphQL',
    extensions: ['.graphql', '.gql'],
    serverCommand: 'graphql-lsp',
    serverArgs: ['server', '-m', 'stream'],
    rootPatterns: ['.graphqlrc', '.graphqlrc.yml', '.graphqlrc.json', 'graphql.config.js'],
  },

  // Nix
  {
    id: 'nix',
    name: 'Nix',
    extensions: ['.nix'],
    serverCommand: 'nil',
    serverArgs: [],
    rootPatterns: ['flake.nix', 'default.nix', 'shell.nix'],
  },

  // Gleam
  {
    id: 'gleam',
    name: 'Gleam',
    extensions: ['.gleam'],
    serverCommand: 'gleam',
    serverArgs: ['lsp'],
    rootPatterns: ['gleam.toml'],
  },

  // Elm
  {
    id: 'elm',
    name: 'Elm',
    extensions: ['.elm'],
    serverCommand: 'elm-language-server',
    serverArgs: [],
    rootPatterns: ['elm.json'],
  },

  // Dart
  {
    id: 'dart',
    name: 'Dart',
    extensions: ['.dart'],
    serverCommand: 'dart',
    serverArgs: ['language-server', '--protocol=lsp'],
    rootPatterns: ['pubspec.yaml'],
  },

  // Julia
  {
    id: 'julia',
    name: 'Julia',
    extensions: ['.jl'],
    serverCommand: 'julia',
    serverArgs: ['--startup-file=no', '--history-file=no', '-e', 'using LanguageServer; runserver()'],
    rootPatterns: ['Project.toml'],
  },

  // R
  {
    id: 'r',
    name: 'R',
    extensions: ['.r', '.R', '.rmd', '.Rmd'],
    serverCommand: 'R',
    serverArgs: ['--slave', '-e', 'languageserver::run()'],
    rootPatterns: ['DESCRIPTION', '.Rproj'],
  },

  // Clojure
  {
    id: 'clojure',
    name: 'Clojure',
    extensions: ['.clj', '.cljs', '.cljc', '.edn'],
    serverCommand: 'clojure-lsp',
    serverArgs: [],
    rootPatterns: ['deps.edn', 'project.clj', 'shadow-cljs.edn'],
  },

  // Nim
  {
    id: 'nim',
    name: 'Nim',
    extensions: ['.nim', '.nims'],
    serverCommand: 'nimlsp',
    serverArgs: [],
    rootPatterns: ['*.nimble'],
  },

  // V
  {
    id: 'vlang',
    name: 'V',
    extensions: ['.v', '.vv'],
    serverCommand: 'vls',
    serverArgs: [],
    rootPatterns: ['v.mod'],
  },

  // Crystal
  {
    id: 'crystal',
    name: 'Crystal',
    extensions: ['.cr'],
    serverCommand: 'crystalline',
    serverArgs: [],
    rootPatterns: ['shard.yml'],
  },

  // D
  {
    id: 'd',
    name: 'D',
    extensions: ['.d'],
    serverCommand: 'serve-d',
    serverArgs: [],
    rootPatterns: ['dub.json', 'dub.sdl'],
  },

  // Erlang
  {
    id: 'erlang',
    name: 'Erlang',
    extensions: ['.erl', '.hrl'],
    serverCommand: 'erlang_ls',
    serverArgs: [],
    rootPatterns: ['rebar.config', 'erlang.mk'],
  },

  // F#
  {
    id: 'fsharp',
    name: 'F#',
    extensions: ['.fs', '.fsx', '.fsi'],
    serverCommand: 'fsautocomplete',
    serverArgs: ['--adaptive-lsp-server-enabled'],
    rootPatterns: ['*.fsproj'],
  },

  // Fortran
  {
    id: 'fortran',
    name: 'Fortran',
    extensions: ['.f', '.f90', '.f95', '.f03', '.f08'],
    serverCommand: 'fortls',
    serverArgs: [],
    rootPatterns: [],
  },

  // LaTeX
  {
    id: 'latex',
    name: 'LaTeX',
    extensions: ['.tex', '.bib'],
    serverCommand: 'texlab',
    serverArgs: [],
    rootPatterns: ['*.tex'],
  },

  // Markdown
  {
    id: 'markdown',
    name: 'Markdown',
    extensions: ['.md', '.markdown'],
    serverCommand: 'marksman',
    serverArgs: [],
    rootPatterns: [],
  },

  // TOML
  {
    id: 'toml',
    name: 'TOML',
    extensions: ['.toml'],
    serverCommand: 'taplo',
    serverArgs: ['lsp', 'stdio'],
    rootPatterns: [],
  },

  // Protobuf
  {
    id: 'protobuf',
    name: 'Protocol Buffers',
    extensions: ['.proto'],
    serverCommand: 'bufls',
    serverArgs: ['serve'],
    rootPatterns: ['buf.yaml', 'buf.gen.yaml'],
  },

  // Assembly (various)
  {
    id: 'asm',
    name: 'Assembly',
    extensions: ['.asm', '.s', '.S'],
    serverCommand: 'asm-lsp',
    serverArgs: [],
    rootPatterns: [],
  },

  // CMake
  {
    id: 'cmake',
    name: 'CMake',
    extensions: ['.cmake'],
    serverCommand: 'cmake-language-server',
    serverArgs: [],
    rootPatterns: ['CMakeLists.txt'],
  },

  // Perl
  {
    id: 'perl',
    name: 'Perl',
    extensions: ['.pl', '.pm'],
    serverCommand: 'pls',
    serverArgs: [],
    rootPatterns: ['cpanfile', 'Makefile.PL'],
  },
]

// Build extension -> language map for fast lookup
const extensionToLanguage = new Map<string, LanguageConfig>()
for (const lang of LANGUAGES) {
  for (const ext of lang.extensions) {
    extensionToLanguage.set(ext, lang)
  }
}

// Special filename matching (case-insensitive)
const specialFilenames: Record<string, LanguageConfig> = {}
const dockerLang = LANGUAGES.find((l) => l.id === 'dockerfile')
if (dockerLang) {
  specialFilenames['dockerfile'] = dockerLang
  specialFilenames['containerfile'] = dockerLang
}

/**
 * Detect language configuration from a file path
 */
export function detectLanguage(filePath: string): LanguageConfig | null {
  // Check special filenames first
  const filename = basename(filePath).toLowerCase()
  const special = specialFilenames[filename]
  if (special) {
    return special
  }

  // Check extension
  const ext = extname(filePath).toLowerCase()
  if (!ext) {
    return null
  }

  return extensionToLanguage.get(ext) ?? null
}

/**
 * Get all supported languages
 */
export function getSupportedLanguages(): LanguageConfig[] {
  return [...LANGUAGES]
}

/**
 * Get language by ID
 */
export function getLanguageById(id: string): LanguageConfig | null {
  return LANGUAGES.find((l) => l.id === id) ?? null
}
