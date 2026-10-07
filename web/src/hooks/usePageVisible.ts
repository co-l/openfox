import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

const isVisible = () => !document.hidden
const serverVisible = () => true

/**
 * Whether the page is visible (tab in the foreground). Timers that only update
 * what is on screen can stop while it is hidden and resume when it is shown.
 */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, isVisible, serverVisible)
}
