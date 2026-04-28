import { defineConfig, mergeConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { createViteWatchOptions } from './vite-watch.js'
import { existsSync } from 'fs'

// Load local config if it exists (gitignored, for local overrides like allowedHosts)
async function loadLocalConfig(): Promise<any> {
  const localPath = path.resolve(__dirname, 'vite.config.local.ts')
  if (existsSync(localPath)) {
    const mod = await import(localPath)
    return mod.default ?? mod
  }
  return {}
}

export default async function config() {
  const localConfig = await loadLocalConfig()
  return mergeConfig(
    defineConfig({
      plugins: [
        react(),
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['assets/openfox-192.png', 'assets/openfox-512.png'],
          manifest: {
            name: 'OpenFox',
            short_name: 'OpenFox',
            description: 'Local-LLM-first agentic coding assistant',
            theme_color: '#0d1117',
            background_color: '#0d1117',
            display: 'standalone',
            orientation: 'portrait',
            icons: [
              {
                src: 'assets/openfox-192.png',
                sizes: '192x192',
                type: 'image/png',
                purpose: 'any',
              },
              {
                src: 'assets/openfox-512.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any',
              },
            ],
          },
        }),
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
          '@shared': path.resolve(__dirname, '../src/shared'),
        },
      },
      root: path.resolve(__dirname),
      build: {
        outDir: '../dist/web',
      },
      server: {
        port: 5173,
        strictPort: true,
        fs: {
          allow: [
            path.resolve(__dirname),
            path.resolve(__dirname, '../node_modules'),
          ],
        },
        watch: createViteWatchOptions(),
        proxy: {
          '/api': {
            target: 'http://localhost:10469',
            changeOrigin: true,
          },
          '/ws': {
            target: 'ws://localhost:10469',
            ws: true,
          },
        },
      },
    }),
    localConfig,
  )
}
