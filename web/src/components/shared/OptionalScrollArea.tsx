import type { CSSProperties, ReactNode } from 'react'
import { ScrollArea } from './ScrollArea'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'

interface OptionalScrollAreaProps {
  children?: ReactNode
  className?: string
  horizontal?: boolean
  style?: CSSProperties
  // Which performance setting controls this area. Code blocks render markdown
  // (often large dumps), so they're tuned independently of tool call panes.
  scope?: 'toolCalls' | 'codeBlocks'
}

/**
 * Styled ScrollArea by default; when the matching performance setting is on,
 * renders a plain native-scrolling div instead (cheaper, but native scrollbars
 * look different on some platforms). The decision happens at render time, so
 * toggling the setting applies immediately to mounted content.
 */
export function OptionalScrollArea({
  children,
  className = '',
  horizontal = false,
  style,
  scope = 'toolCalls',
}: OptionalScrollAreaProps) {
  const { useNativeScrollbars, useNativeScrollbarsCodeBlocks } = useDisplaySettings()
  const native = scope === 'codeBlocks' ? useNativeScrollbarsCodeBlocks : useNativeScrollbars

  if (native) {
    const overflowClass = horizontal ? 'overflow-x-auto' : 'overflow-y-auto'
    return (
      <div className={`${overflowClass} ${className}`.trim()} style={style}>
        {children}
      </div>
    )
  }

  return (
    <ScrollArea horizontal={horizontal} className={className} style={style}>
      {children}
    </ScrollArea>
  )
}
