import type React from 'react'

export function dedupById<T extends { id: string }>(defaults: T[], overrides: T[]): T[] {
  const overrideIds = new Set(overrides.map((i) => i.id))
  return [...defaults.filter((i) => !overrideIds.has(i.id)), ...overrides]
}

export function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true
  const queryParts = query.toLowerCase().split(/\s+/)
  const words = text.toLowerCase().split(/\s+/)
  return queryParts.every((qp) => {
    for (const word of words) {
      let qi = 0
      for (let ni = 0; ni < word.length && qi < qp.length; ni++) {
        if (word[ni] === qp[qi]) qi++
      }
      if (qi === qp.length) return true
    }
    return false
  })
}

export function handleModalNavigation(
  e: React.KeyboardEvent,
  maxIndex: number,
  setSelectedIndex: (fn: (i: number) => number) => void,
  onEnter: () => void,
  onEscape: () => void,
) {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, maxIndex))
      break
    case 'ArrowUp':
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
      break
    case 'Enter':
      e.preventDefault()
      onEnter()
      break
    case 'Escape':
      e.preventDefault()
      onEscape()
      break
  }
}
