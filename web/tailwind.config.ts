import type { Config } from 'tailwindcss'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default {
  content: [path.join(__dirname, 'index.html'), path.join(__dirname, 'src', '**', '*.{js,ts,jsx,tsx}')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'rgb(var(--color-bg-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-bg-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--color-bg-tertiary) / <alpha-value>)',
          system: 'rgb(var(--color-bg-system) / <alpha-value>)',
        },
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        secondary: 'rgb(var(--color-secondary) / <alpha-value>)',
        text: {
          primary: 'rgb(var(--color-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted) / <alpha-value>)',
          heading: 'rgb(var(--color-text-heading) / <alpha-value>)',
          bold: 'rgb(var(--color-text-bold) / <alpha-value>)',
          code: 'rgb(var(--color-text-code) / <alpha-value>)',
          link: 'rgb(var(--color-text-link) / <alpha-value>)',
          system: 'rgb(var(--color-text-system) / <alpha-value>)',
          thinking: 'rgb(var(--color-text-thinking) / <alpha-value>)',
          truncated: 'rgb(var(--color-text-truncated) / <alpha-value>)',
          'tool-error': 'rgb(var(--color-text-tool-error) / <alpha-value>)',
        },
        accent: {
          primary: 'rgb(var(--color-accent-primary) / <alpha-value>)',
          success: 'rgb(var(--color-accent-success) / <alpha-value>)',
          warning: 'rgb(var(--color-accent-warning) / <alpha-value>)',
          error: 'rgb(var(--color-accent-error) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
          system: 'rgb(var(--color-border-system) / <alpha-value>)',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      keyframes: {
        'slide-down': {
          '0%': { transform: 'translateY(-100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'highlight-fade': {
          '0%': { boxShadow: '0 0 0 2px rgb(var(--color-accent-primary) / 1)' },
          '100%': { boxShadow: '0 0 0 2px rgb(var(--color-accent-primary) / 0)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'slide-down': 'slide-down 0.2s ease-out forwards',
        'highlight-fade': 'highlight-fade 3s ease-out forwards',
        'fade-in': 'fade-in 0.2s ease-out forwards',
      },
    },
  },
  plugins: [],
} satisfies Config
