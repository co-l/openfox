import { useMemo } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface DiffViewProps {
  oldString: string
  newString: string
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

// Custom style overrides for diff highlighting
const removedStyle: React.CSSProperties = {
  margin: 0,
  padding: '2px 8px',
  borderRadius: 0,
  fontSize: '0.75rem',
  background: 'rgba(248, 81, 73, 0.15)',
  borderLeft: '3px solid rgb(248, 81, 73)',
}

const addedStyle: React.CSSProperties = {
  margin: 0,
  padding: '2px 8px',
  borderRadius: 0,
  fontSize: '0.75rem',
  background: 'rgba(63, 185, 80, 0.15)',
  borderLeft: '3px solid rgb(63, 185, 80)',
}

export function DiffView({ oldString, newString, filePath }: DiffViewProps) {
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
    <div className="rounded overflow-hidden border border-border">
      {/* Removed content */}
      {hasOld && (
        <div className="relative">
          <div className="absolute left-0 top-0 bottom-0 w-6 bg-red-500/10 flex items-start justify-center pt-1 text-red-400 text-xs font-mono">
            {oldLines.map((_, i) => (
              <span key={i} className="block leading-[1.35rem]">-</span>
            ))}
          </div>
          <div className="pl-6">
            <SyntaxHighlighter
              style={oneDark}
              language={language}
              PreTag="div"
              customStyle={removedStyle}
              codeTagProps={{
                style: {
                  textDecoration: 'line-through',
                  textDecorationColor: 'rgba(248, 81, 73, 0.5)',
                }
              }}
            >
              {oldString}
            </SyntaxHighlighter>
          </div>
        </div>
      )}
      
      {/* Added content */}
      {hasNew && (
        <div className="relative">
          <div className="absolute left-0 top-0 bottom-0 w-6 bg-green-500/10 flex items-start justify-center pt-1 text-green-400 text-xs font-mono">
            {newLines.map((_, i) => (
              <span key={i} className="block leading-[1.35rem]">+</span>
            ))}
          </div>
          <div className="pl-6">
            <SyntaxHighlighter
              style={oneDark}
              language={language}
              PreTag="div"
              customStyle={addedStyle}
            >
              {newString}
            </SyntaxHighlighter>
          </div>
        </div>
      )}
    </div>
  )
}

// Preview component for write_file (shows new content only)
interface FilePreviewProps {
  content: string
  filePath?: string
  maxLines?: number
}

export function FilePreview({ content, filePath, maxLines = 20 }: FilePreviewProps) {
  const language = useMemo(() => getLanguageFromPath(filePath), [filePath])
  
  const lines = content.split('\n')
  const isTruncated = lines.length > maxLines
  const displayContent = isTruncated 
    ? lines.slice(0, maxLines).join('\n') + '\n...'
    : content
  
  return (
    <div className="rounded overflow-hidden border border-border">
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-6 bg-green-500/10 flex items-start justify-center pt-1 text-green-400 text-xs font-mono">
          {displayContent.split('\n').map((_, i) => (
            <span key={i} className="block leading-[1.35rem]">+</span>
          ))}
        </div>
        <div className="pl-6">
          <SyntaxHighlighter
            style={oneDark}
            language={language}
            PreTag="div"
            customStyle={addedStyle}
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
}
