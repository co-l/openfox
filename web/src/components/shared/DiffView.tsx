import { memo, useMemo, useState } from 'react'
import { CodeHighlight } from './CodeHighlight'
import { getLanguageFromPath } from '../../lib/syntax-highlighter'
export { getLanguageFromPath, wrappedCodeStyle } from '../../lib/syntax-highlighter'
import type { EditContextRegion } from '@shared/types.js'
import { ImageModal } from './ImageModal'
import { Markdown } from './Markdown'

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

interface DiffSectionProps {
  type: 'removed' | 'added'
  children: React.ReactNode
}

const DiffSection = memo(function DiffSection({ type, children }: DiffSectionProps) {
  const bgClass = type === 'removed' ? 'diff-removed-bg diff-removed-border' : 'diff-added-bg diff-added-border'
  const lineClass = type === 'removed' ? 'line-through decoration-red-400/30' : ''

  return (
    <div className={`border-l-[3px] ${bgClass}`}>
      <div className={`min-w-0 py-3 ${lineClass}`}>
        <div className="shiki-compact shiki-transparent-bg">{children}</div>
      </div>
    </div>
  )
})

export const DiffView = memo(function DiffView({ oldString, newString, filePath }: DiffViewProps) {
  const language = useMemo(() => getLanguageFromPath(filePath), [filePath])

  const hasOld = oldString.length > 0
  const hasNew = newString.length > 0

  if (!hasOld && !hasNew) {
    return <div className="text-xs text-text-muted italic p-2">No changes</div>
  }

  return (
    <div className="rounded overflow-hidden border border-border">
      {hasOld && (
        <DiffSection type="removed">
          <CodeHighlight code={oldString} language={language} variant="block" showLineNumbers />
        </DiffSection>
      )}
      {hasNew && (
        <DiffSection type="added">
          <CodeHighlight code={newString} language={language} variant="block" showLineNumbers />
        </DiffSection>
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
      <DiffSection type="added">
        <CodeHighlight code={content} language={language} variant="block" showLineNumbers />
      </DiffSection>
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
    return <div className="text-xs text-text-muted italic p-2">No changes</div>
  }

  return (
    <div className="space-y-2">
      {regions.map((region, regionIndex) => (
        <EditRegionView key={regionIndex} region={region} language={language} />
      ))}
    </div>
  )
})

interface EditRegionViewProps {
  region: EditContextRegion
  language: string
}

type SectionType = 'context' | 'removed' | 'added'

interface SectionGroup {
  type: SectionType
  startLine: number
  lines: string[]
}

function groupIntoSections(region: EditContextRegion): SectionGroup[] {
  const groups: SectionGroup[] = []

  function push(type: SectionType, lineNumber: number, content: string) {
    const last = groups[groups.length - 1]
    if (last && last.type === type && last.startLine + last.lines.length === lineNumber) {
      last.lines.push(content)
    } else {
      groups.push({ type, startLine: lineNumber, lines: [content] })
    }
  }

  for (const line of region.beforeContext) {
    push('context', line.lineNumber, line.content)
  }

  for (const edit of region.edits) {
    const oldLines = edit.oldContent.split('\n')
    for (let i = 0; i < oldLines.length; i++) {
      push('removed', edit.startLine + i, oldLines[i]!)
    }
    const newLines = edit.newContent.split('\n')
    for (let i = 0; i < newLines.length; i++) {
      push('added', edit.startLine + i, newLines[i]!)
    }
  }

  for (const line of region.afterContext) {
    push('context', line.lineNumber, line.content)
  }

  return groups
}

const EditRegionView = memo(function EditRegionView({ region, language }: EditRegionViewProps) {
  const sections = groupIntoSections(region)

  return (
    <div className="rounded overflow-hidden border border-border font-mono text-sm">
      {sections.map((section, i) => (
        <SectionView key={i} section={section} language={language} />
      ))}
    </div>
  )
})

interface SectionViewProps {
  section: SectionGroup
  language: string
}

const SectionView = memo(function SectionView({ section, language }: SectionViewProps) {
  const content = section.lines.join('\n')

  if (section.type === 'context') {
    return (
      <div>
        <div className="min-w-0 py-3">
          <div className="shiki-compact shiki-transparent-bg">
            <CodeHighlight
              code={content}
              language={language}
              variant="block"
              showLineNumbers
              startLine={section.startLine}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <DiffSection type={section.type}>
      <CodeHighlight code={content} language={language} variant="block" showLineNumbers startLine={section.startLine} />
    </DiffSection>
  )
})

// Read file view - shows syntax-highlighted text or inline image
interface ReadFileViewProps {
  result?: string
  metadata?: Record<string, unknown>
  filePath: string
  heightExpanded?: boolean
}

function stripLineNumbers(content: string): string {
  return content
    .split('\n')
    .filter((l) => !l.startsWith('\n[') && !l.startsWith('['))
    .map((l) => l.replace(/^\d+: /, ''))
    .join('\n')
}

export const ReadFileView = memo(function ReadFileView({
  result,
  metadata,
  filePath,
  heightExpanded = false,
}: ReadFileViewProps) {
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
          <img src={src} alt={filePath} className="max-w-full max-h-[45vh] object-contain" />
        </div>
        <ImageModal src={src} alt={filePath} isOpen={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    )
  }

  // Text file - show with syntax highlighting
  if (!result) {
    return <div className="text-xs text-text-muted italic p-2">Empty file</div>
  }

  const content: string = result

  // For markdown files, render as markdown instead of syntax-highlighted code
  if (language === 'markdown') {
    const strippedContent = stripLineNumbers(content)

    return (
      <div
        className={`rounded overflow-hidden border border-border ${heightExpanded ? '' : 'max-h-[45vh]'} overflow-y-auto p-2`}
      >
        <Markdown content={strippedContent} />
      </div>
    )
  }

  // For other file types, show with syntax highlighting and line numbers
  const strippedContent = stripLineNumbers(content)
  const firstLine = content.split('\n')[0]
  const startMatch = firstLine?.match(/^(\d+): /)
  const startLine = startMatch ? parseInt(startMatch[1]!, 10) : 1

  return (
    <div
      className={`rounded overflow-hidden border border-border ${heightExpanded ? '' : 'max-h-[45vh]'} overflow-y-auto`}
    >
      <CodeHighlight code={strippedContent} language={language} variant="block" showLineNumbers startLine={startLine} />
    </div>
  )
})
