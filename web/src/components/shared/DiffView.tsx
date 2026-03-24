import { memo, useMemo, useState } from 'react'
import { CodeHighlight, getLanguageFromPath } from './CodeHighlight'
export { getLanguageFromPath, wrappedCodeStyle, oneDarkTransparent } from './CodeHighlight'
import type { EditContextRegion } from '../../../src/shared/types.js'
import { ImageModal } from './ImageModal'

interface DiffViewProps {
  oldString: string
  newString: string
  filePath?: string
}

/** Props for the new context-aware diff view */
interface EditContextViewProps {
  regions: EditContextRegion[]
  filePath?: string
}


export const DiffView = memo(function DiffView({ oldString, newString, filePath }: DiffViewProps) {
  const language = useMemo(() => getLanguageFromPath(filePath), [filePath])
  
  const oldLines = oldString.split('\n')
  const newLines = newString.split('\n')
  
  // Handle empty strings
  const hasOld = oldString.length > 0
  const hasNew = newString.length > 0
  
  if (!hasOld && !hasNew) {
    return (
      <div className="text-xs text-text-muted italic p-2">
        No changes
      </div>
    )
  }
  
  return (
    <div className="rounded overflow-hidden border border-border grid grid-cols-[3px_1.5rem_1fr]">
      {/* Removed content */}
      {hasOld && (
        <>
          <div className="bg-red-400/60" />
          <div className="bg-red-950/30 text-red-400/70 text-sm font-mono text-center">
            {oldLines.map((_, i) => (
              <div key={i} className="leading-[1.5rem]">-</div>
            ))}
          </div>
          <div className="bg-red-950/30 pr-2 line-through decoration-red-400/30 overflow-x-auto min-w-0">
            <CodeHighlight code={oldString} language={language} variant="block-nowrap" />
          </div>
        </>
      )}
      
      {/* Added content */}
      {hasNew && (
        <>
          <div className="bg-green-400/60" />
          <div className="bg-green-950/30 text-green-400/70 text-sm font-mono text-center">
            {newLines.map((_, i) => (
              <div key={i} className="leading-[1.5rem]">+</div>
            ))}
          </div>
          <div className="bg-green-950/30 pr-2 overflow-x-auto min-w-0">
            <CodeHighlight code={newString} language={language} variant="block-nowrap" />
          </div>
        </>
      )}
    </div>
  )
})

// Preview component for write_file (shows new content only)
interface FilePreviewProps {
  content: string
  filePath?: string
}

export const FilePreview = memo(function FilePreview({ content, filePath }: FilePreviewProps) {
  const language = useMemo(() => getLanguageFromPath(filePath), [filePath])

  return (
    <div className="rounded overflow-hidden border border-border max-h-[45vh] overflow-y-auto">
      <div className="grid grid-cols-[3px_1.5rem_1fr]">
        <div className="bg-green-400/60" />
        <div className="bg-green-950/30 text-green-400/70 text-sm font-mono text-center">
          {content.split('\n').map((_, i) => (
            <div key={i} className="leading-[1.5rem]">+</div>
          ))}
        </div>
        <div className="bg-green-950/30 pr-2 min-w-0 overflow-x-hidden">
          <CodeHighlight code={content} language={language} variant="block" />
        </div>
      </div>
    </div>
  )
})

/**
 * Renders edit context with line numbers, showing:
 * - Context lines before (muted)
 * - Old content (red, strikethrough) with line numbers
 * - New content (green) with line numbers
 * - Context lines after (muted)
 * 
 * Supports multiple edits per region (for replace_all with overlapping contexts).
 */
export const EditContextView = memo(function EditContextView({ regions, filePath }: EditContextViewProps) {
  const language = useMemo(() => getLanguageFromPath(filePath), [filePath])
  
  if (regions.length === 0) {
    return (
      <div className="text-xs text-text-muted italic p-2">
        No changes
      </div>
    )
  }
  
  return (
    <div className="space-y-2">
      {regions.map((region, regionIndex) => (
        <EditRegionView
          key={regionIndex}
          region={region}
          language={language}
        />
      ))}
    </div>
  )
})

interface EditRegionViewProps {
  region: EditContextRegion
  language: string
}

const EditRegionView = memo(function EditRegionView({ region, language }: EditRegionViewProps) {
  // Build the display items: context lines, edits (with intermediate context), trailing context
  const items = buildDisplayItems(region)
  
  // Calculate max line number width for consistent alignment
  const maxLineNum = Math.max(
    ...region.beforeContext.map(l => l.lineNumber),
    ...region.afterContext.map(l => l.lineNumber),
    ...region.edits.flatMap(e => [e.startLine, e.endLine]),
  )
  const lineNumWidth = String(maxLineNum).length
  
  return (
    <div className="rounded overflow-hidden border border-border font-mono text-sm">
      {items.map((item, i) => (
        <DisplayItemRow
          key={i}
          item={item}
          language={language}
          lineNumWidth={lineNumWidth}
        />
      ))}
    </div>
  )
})

type DisplayItem =
  | { type: 'context'; lineNumber: number; content: string }
  | { type: 'removed'; lineNumber: number; content: string }
  | { type: 'added'; lineNumber: number; content: string }

/**
 * Build display items from a region, interleaving context and edits correctly.
 */
function buildDisplayItems(region: EditContextRegion): DisplayItem[] {
  const items: DisplayItem[] = []
  
  // Before context
  for (const line of region.beforeContext) {
    items.push({ type: 'context', lineNumber: line.lineNumber, content: line.content })
  }
  
  // Edits - for multiple edits in a merged region
  for (const edit of region.edits) {
    // Show removed lines
    const oldLines = edit.oldContent.split('\n')
    for (let i = 0; i < oldLines.length; i++) {
      items.push({
        type: 'removed',
        lineNumber: edit.startLine + i,
        content: oldLines[i]!,
      })
    }
    
    // Show added lines (use same starting line number for the "replacement")
    const newLines = edit.newContent.split('\n')
    for (let i = 0; i < newLines.length; i++) {
      items.push({
        type: 'added',
        lineNumber: edit.startLine + i,
        content: newLines[i]!,
      })
    }
  }
  
  // After context
  for (const line of region.afterContext) {
    items.push({ type: 'context', lineNumber: line.lineNumber, content: line.content })
  }
  
  return items
}

interface DisplayItemRowProps {
  item: DisplayItem
  language: string
  lineNumWidth: number
}

const DisplayItemRow = memo(function DisplayItemRow({ item, language, lineNumWidth }: DisplayItemRowProps) {
  const lineNumStr = String(item.lineNumber).padStart(lineNumWidth, ' ')
  
  const bgClass = item.type === 'context' 
    ? 'bg-bg-secondary'
    : item.type === 'removed'
    ? 'bg-red-950/30'
    : 'bg-green-950/30'
  
  const indicatorClass = item.type === 'context'
    ? 'text-text-muted'
    : item.type === 'removed'
    ? 'text-red-400/70'
    : 'text-green-400/70'
  
  const indicator = item.type === 'context' ? ' ' : item.type === 'removed' ? '-' : '+'
  
  const lineClass = item.type === 'removed' 
    ? 'line-through decoration-red-400/30' 
    : ''
  
  const accentClass = item.type === 'context'
    ? 'bg-transparent'
    : item.type === 'removed'
    ? 'bg-red-400/60'
    : 'bg-green-400/60'
  
  return (
    <div className={`grid grid-cols-[3px_auto_1.25rem_1fr] ${bgClass}`}>
      {/* Color accent bar */}
      <div className={accentClass} />
      
      {/* Line number */}
      <div className="px-2 text-text-muted text-right select-none leading-[1.5rem]">
        {lineNumStr}
      </div>
      
      {/* +/- indicator */}
      <div className={`text-center select-none leading-[1.5rem] ${indicatorClass}`}>
        {indicator}
      </div>
      
      {/* Code content */}
      <div className={`pr-2 overflow-x-auto min-w-0 ${lineClass}`}>
        <CodeHighlight code={item.content || ' '} language={language} variant="inline" />
      </div>
    </div>
  )
})

// Read file view - shows syntax-highlighted text or inline image
interface ReadFileViewProps {
  result?: string
  metadata?: Record<string, unknown>
  filePath: string
  heightExpanded?: boolean
}

export const ReadFileView = memo(function ReadFileView({ result, metadata, filePath, heightExpanded = false }: ReadFileViewProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const language = useMemo(() => getLanguageFromPath(filePath), [filePath])

  // Image file - metadata contains base64Data and mimeType
  const mimeType = metadata?.mimeType as string | undefined
  const base64Data = metadata?.base64Data as string | undefined
  if (mimeType?.startsWith('image/') && base64Data) {
    const src = `data:${mimeType};base64,${base64Data}`
    return (
      <>
        <div
          className={`rounded overflow-hidden border border-border ${heightExpanded ? '' : 'max-h-[45vh]'} flex items-center justify-center cursor-pointer hover:border-accent-primary transition-colors`}
          onClick={() => setModalOpen(true)}
        >
          <img
            src={src}
            alt={filePath}
            className="max-w-full max-h-[45vh] object-contain"
          />
        </div>
        <ImageModal
          src={src}
          alt={filePath}
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
        />
      </>
    )
  }

  // Text file - show with syntax highlighting
  if (!result) {
    return (
      <div className="text-xs text-text-muted italic p-2">
        Empty file
      </div>
    )
  }

  // Strip line numbers prefix (format: "1: content") for syntax highlighting
  const lines = result.split('\n')
  const strippedContent = lines
    .filter(l => !l.startsWith('\n[') && !l.startsWith('['))
    .map(l => l.replace(/^\d+: /, ''))
    .join('\n')

  return (
    <div className={`rounded overflow-hidden border border-border ${heightExpanded ? '' : 'max-h-[45vh]'} overflow-y-auto`}>
      <div className="grid grid-cols-[2.5rem_1fr]">
        <div className="bg-bg-tertiary text-text-muted text-xs font-mono text-right pr-2 select-none py-0.5">
          {lines
            .filter(l => !l.startsWith('\n[') && !l.startsWith('['))
            .map((l, i) => {
              const match = l.match(/^(\d+): /)
              return (
                <div key={i} className="leading-[1.5rem]">
                  {match ? match[1] : i + 1}
                </div>
              )
            })}
        </div>
        <div className="min-w-0 overflow-x-hidden py-0.5">
          <CodeHighlight code={strippedContent} language={language} variant="block" />
        </div>
      </div>
    </div>
  )
})
