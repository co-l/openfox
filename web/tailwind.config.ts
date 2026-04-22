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
        primary: '#0a0a0a',
        secondary: '#141414',
        text: {
          primary: '#8b949e',
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
      keyframes: {
        'slide-down': {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'slide-down': 'slide-down 0.2s ease-out forwards',
      },
    },
  },
  plugins: [],
} satisfies Config
