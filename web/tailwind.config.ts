import type { Config } from 'tailwindcss'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default {
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src', '**', '*.{js,ts,jsx,tsx}'),
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0d1117',
          secondary: '#161b22',
          tertiary: '#21262d',
        },
        text: {
          primary: '#c9d1d9',
          secondary: '#8b949e',
          muted: '#484f58',
        },
        accent: {
          primary: '#58a6ff',
          success: '#3fb950',
          warning: '#d29922',
          error: '#f85149',
        },
        border: '#282e36',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
