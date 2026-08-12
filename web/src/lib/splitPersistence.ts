import { useLocation } from 'wouter'

export interface SplitLayout {
  openSessionIds: string[]
  focusedSessionId: string | null
}

export const SPLIT_ROUTE = '/split-view'

const SPLIT_KEY = 'openfox:split'
const LAYOUT_KEY = 'openfox:split:layout'

export type SplitLayoutMode = 'columns' | 'grid'

/** True when the current URL is the split-view route. */
export function isSplitRoute(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.pathname === SPLIT_ROUTE
}

/** Reactive split-route flag: subscribes to wouter's location. */
export function useIsSplit(): boolean {
  const [location] = useLocation()
  return location === SPLIT_ROUTE
}

/** Pane arrangement preference — columns (default) or a 2-up grid. */
export function readSplitLayoutMode(): SplitLayoutMode {
  if (typeof localStorage === 'undefined') return 'columns'
  return localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'columns'
}

export function writeSplitLayoutMode(mode: SplitLayoutMode) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LAYOUT_KEY, mode)
}

export function readSplitLayout(): SplitLayout | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(SPLIT_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SplitLayout>
    if (!Array.isArray(parsed.openSessionIds)) return null
    const openSessionIds = (parsed.openSessionIds as string[]).filter(Boolean)
    const focusedSessionId = typeof parsed.focusedSessionId === 'string' ? parsed.focusedSessionId : null
    return { openSessionIds, focusedSessionId }
  } catch {
    return null
  }
}

export function writeSplitLayout(layout: SplitLayout | null) {
  if (typeof localStorage === 'undefined') return
  if (!layout || layout.openSessionIds.length === 0) {
    localStorage.removeItem(SPLIT_KEY)
    return
  }
  localStorage.setItem(SPLIT_KEY, JSON.stringify(layout))
}
