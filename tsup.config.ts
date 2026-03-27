import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'cli/dev': 'src/cli/dev.ts',
    'server/index': 'src/server/index.ts',
    'shared/index': 'src/shared/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['better-sqlite3', 'vscode-jsonrpc', 'vscode-languageserver-protocol', 'ws'],
})
