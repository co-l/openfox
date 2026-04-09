import { defineConfig } from 'tsup'
import { readFileSync, existsSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const isDev = existsSync('./.git')
const version = isDev ? `${pkg.version}-dev` : pkg.version

export default defineConfig({
  define: {
    'process.env.OPENFOX_VERSION': JSON.stringify(version),
  },
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
  external: ['better-sqlite3', 'vscode-jsonrpc', 'vscode-languageserver-protocol', 'ws', 'node-pty'],
})
