import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { createViteWatchOptions } from './vite-watch.js'

export default defineConfig({
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
  root: path.resolve(__dirname),  // Use web/ directory as root
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
    // In dev mode, users access Vite directly (for HMR to work)
    // Vite proxies API/WS to the backend server
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
})
