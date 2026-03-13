import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/protocol.ts', 'src/types.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
})
