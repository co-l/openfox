import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'cli/dev': 'src/cli/dev.ts',
    'server/history/process-entry': 'src/server/history/process-entry.ts',
    'server/index': 'src/server/index.ts',
    'shared/index': 'src/shared/index.ts',
  },
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  external: ['better-sqlite3', 'vscode-jsonrpc', 'vscode-languageserver-protocol', 'ws'],
})
