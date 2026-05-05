/**
 * ANSI color code parser for terminal output
 * Converts ANSI escape sequences to React elements with Tailwind CSS styling
 */

// ANSI color code mappings to Tailwind CSS classes
const ANSI_COLORS: Record<number, string> = {
  30: 'text-black',
  31: 'text-red-400',
  32: 'text-accent-success',
  33: 'text-accent-warning',
  34: 'text-blue-400',
  35: 'text-purple-400',
  36: 'text-cyan-400',
  37: 'text-gray-300',
  90: 'text-gray-500', // bright black
  91: 'text-red-500', // bright red
  92: 'text-green-500', // bright green
  93: 'text-yellow-400', // bright yellow
  94: 'text-blue-500', // bright blue
  95: 'text-pink-400', // bright magenta
  96: 'text-cyan-500', // bright cyan
  97: 'text-white', // bright white
}

const ANSI_BG_COLORS: Record<number, string> = {
  40: 'bg-black',
  41: 'bg-red-900',
  42: 'bg-green-900',
  43: 'bg-yellow-900',
  44: 'bg-blue-900',
  45: 'bg-purple-900',
  46: 'bg-cyan-900',
  47: 'bg-gray-700',
}

const ANSI_STYLES: Record<number, string> = {
  1: 'font-bold',
  2: 'opacity-75', // dim
  4: 'underline',
  7: 'bg-bg-secondary', // inverse
}

// Reset all styles
const ANSI_RESET = 'text-text-primary'

interface ParsedSegment {
  text: string
  className: string
}

/**
 * Parse ANSI escape sequences and return array of styled segments
 * Falls back to stripping codes if parsing fails
 */
export function parseAnsi(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = []

  // Regex to match ANSI escape sequences
  const ansiRegex = /\x1b\[([0-9;]+)m/g

  let lastIndex = 0
  let currentClasses = 'text-text-primary'
  let match: RegExpExecArray | null

  try {
    while ((match = ansiRegex.exec(text)) !== null) {
      // Add text before this escape code
      if (match.index > lastIndex) {
        const textSegment = text.slice(lastIndex, match.index)
        if (textSegment) {
          segments.push({
            text: textSegment,
            className: currentClasses,
          })
        }
      }

      // Parse the escape code parameters
      const paramsStr = match[1]
      if (!paramsStr) continue
      const params = paramsStr.split(';').map(Number)

      // Reset on 0 or no params
      if (params.length === 0 || params[0] === 0) {
        currentClasses = 'text-text-primary'
        continue
      }

      // Build class string from parameters
      const classes: string[] = []

      for (const param of params) {
        if (param >= 30 && param <= 37) {
          // Foreground color
          const colorClass = ANSI_COLORS[param]
          if (colorClass) classes.push(colorClass)
        } else if (param >= 40 && param <= 47) {
          // Background color
          const bgClass = ANSI_BG_COLORS[param]
          if (bgClass) classes.push(bgClass)
        } else if (param >= 90 && param <= 97) {
          // Bright foreground color
          const colorClass = ANSI_COLORS[param]
          if (colorClass) classes.push(colorClass)
        } else if (param in ANSI_STYLES) {
          // Text style
          const styleClass = ANSI_STYLES[param as keyof typeof ANSI_STYLES]
          if (styleClass) classes.push(styleClass)
        } else if (param === 39) {
          // Default foreground
          classes.push(ANSI_RESET)
        } else if (param === 49) {
          // Default background - remove bg classes
          currentClasses = currentClasses
            .split(' ')
            .filter((c) => !c.startsWith('bg-'))
            .join(' ')
        }
      }

      if (classes.length > 0) {
        currentClasses = classes.join(' ')
      }

      lastIndex = ansiRegex.lastIndex
    }

    // Add remaining text after last escape code
    if (lastIndex < text.length) {
      const textSegment = text.slice(lastIndex)
      if (textSegment) {
        segments.push({
          text: textSegment,
          className: currentClasses,
        })
      }
    }

    return segments
  } catch (error) {
    // Fallback: strip all ANSI codes
    console.warn('ANSI parsing failed, stripping codes:', error)
    return [
      {
        text: stripAnsi(text),
        className: 'text-text-primary',
      },
    ]
  }
}

/**
 * Strip all ANSI escape sequences from text
 * Used as fallback or when colors are not needed
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[([0-9;]+)m/g, '')
}

/**
 * Convert parsed segments to React nodes
 */
import React from 'react'

export function ansiToReact(text: string): React.ReactNode {
  const segments = parseAnsi(text)

  const nodes: React.ReactNode[] = []

  segments.forEach((segment, index) => {
    const lines = segment.text.split('\n')
    lines.forEach((line, lineIndex) => {
      nodes.push(
        React.createElement(
          'span',
          {
            key: `${index}-${lineIndex}`,
            className: segment.className,
            style: { display: 'inline-block', whiteSpace: 'pre-wrap' },
          },
          line,
        ),
      )
      if (lineIndex < lines.length - 1) {
        nodes.push(React.createElement('br', { key: `${index}-${lineIndex}-br` }))
      }
    })
  })

  return nodes.length === 1 ? nodes[0] : nodes
}
