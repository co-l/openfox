import { memo, useMemo } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

// Custom oneDark theme with transparent backgrounds (no ugly grey line backgrounds)
const oneDarkTransparent = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...(oneDark['pre[class*="language-"]'] as Record<string, unknown>),
    background: 'transparent',
  },
  'code[class*="language-"]': {
    ...(oneDark['code[class*="language-"]'] as Record<string, unknown>),
    background: 'transparent',
  },
}
import type { EditContextRegion } from '@openfox/shared'

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

// Map file extensions to Prism language names
const extensionToLanguage: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  ps1: 'powershell',
  sql: 'sql',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  toml: 'toml',
  ini: 'ini',
  conf: 'ini',
  dockerfile: 'docker',
  makefile: 'makefile',
  cmake: 'cmake',
  graphql: 'graphql',
  gql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
}

function getLanguageFromPath(filePath?: string): string {
  if (!filePath) return 'text'
  
  const fileName = filePath.split('/').pop() ?? ''
  
  // Handle special filenames
  const lowerName = fileName.toLowerCase()
  if (lowerName === 'dockerfile') return 'docker'
  if (lowerName === 'makefile') return 'makefile'
  if (lowerName === 'cmakelists.txt') return 'cmake'
  
  // Get extension
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (!ext) return 'text'
  
  return extensionToLanguage[ext] ?? 'text'
}

// Custom style overrides for diff highlighting (minimal - use Tailwind for layout)
const codeStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  borderRadius: 0,
  fontSize: '0.875rem',    // 14px to match text-sm
  lineHeight: '1.5rem',    // 24px for consistent line alignment
  background: 'transparent',
}

// Static inline variant to avoid creating new objects on every render
const inlineCodeStyle: React.CSSProperties = {
  ...codeStyle,
  display: 'inline',
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
            <SyntaxHighlighter
              style={oneDarkTransparent}
              language={language}
              PreTag="div"
              customStyle={codeStyle}
            >
              {oldString}
            </SyntaxHighlighter>
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
            <SyntaxHighlighter
              style={oneDarkTransparent}
              language={language}
              PreTag="div"
              customStyle={codeStyle}
            >
              {newString}
            </SyntaxHighlighter>
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
  maxLines?: number
}

export const FilePreview = memo(function FilePreview({ content, filePath, maxLines = 20 }: FilePreviewProps) {
  const language = useMemo(() => getLanguageFromPath(filePath), [filePath])
  
  const lines = content.split('\n')
  const isTruncated = lines.length > maxLines
  const displayContent = isTruncated 
    ? lines.slice(0, maxLines).join('\n') + '\n...'
    : content
  
  return (
    <div className="rounded overflow-hidden border border-border">
      <div className="grid grid-cols-[3px_1.5rem_1fr]">
        <div className="bg-green-400/60" />
        <div className="bg-green-950/30 text-green-400/70 text-sm font-mono text-center">
          {displayContent.split('\n').map((_, i) => (
            <div key={i} className="leading-[1.5rem]">+</div>
          ))}
        </div>
        <div className="bg-green-950/30 pr-2 overflow-x-auto min-w-0">
          <SyntaxHighlighter
            style={oneDarkTransparent}
            language={language}
            PreTag="div"
            customStyle={codeStyle}
          >
            {displayContent}
          </SyntaxHighlighter>
        </div>
      </div>
      {isTruncated && (
        <div className="text-xs text-text-muted px-2 py-1 bg-bg-tertiary border-t border-border">
          ... {lines.length - maxLines} more lines
        </div>
      )}
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
        <SyntaxHighlighter
          style={oneDarkTransparent}
          language={language}
          PreTag="span"
          customStyle={inlineCodeStyle}
        >
          {item.content || ' '}
        </SyntaxHighlighter>
      </div>
    </div>
  )
})
