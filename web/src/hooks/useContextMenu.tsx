import { useState, useCallback } from 'react'
import { ContextMenu, type ContextMenuItem } from '../components/shared/ContextMenu'

export function useContextMenu() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const onContextMenu = useCallback((e: React.MouseEvent, enabled: boolean) => {
    if (!enabled) return
    if (window.getSelection()?.toString()) return
    e.preventDefault()
    setPos({ x: e.clientX, y: e.clientY })
  }, [])

  const contextMenu = (items: ContextMenuItem[]) => (
    <ContextMenu position={pos} onClose={() => setPos(null)} items={items} />
  )

  return { onContextMenu, contextMenu }
}
