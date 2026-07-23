import { memo, useMemo, useEffect, useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightCode, useShikiTheme } from '../../lib/syntax-highlighter'
import { useDisplaySettings } from '../../stores/settings'
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard'
import { CheckIcon, CopyIcon } from './icons'

interface MarkdownProps {
  content: string
  className?: string
  muted?: boolean
}

const CodeBlock = memo(function CodeBlock({
  language,
  codeString,
  showSyntaxHighlighting,
}: {
  language: string
  codeString: string
  showSyntaxHighlighting: boolean
}) {
  const { copied, copy } = useCopyToClipboard()
  const [html, setHtml] = useState<string | null>(null)
  const shikiTheme = useShikiTheme()
  const latestCodeRef = useRef(codeString)

  useEffect(() => {
    if (!showSyntaxHighlighting) return
    latestCodeRef.current = codeString
    highlightCode(codeString, language, shikiTheme).then((result) => {
      if (latestCodeRef.current === codeString) {
        setHtml(result)
      }
    })
  }, [codeString, language, shikiTheme, showSyntaxHighlighting])

  return (
    <div className="relative group my-1.5 rounded overflow-hidden">
      <div className="absolute bottom-0 right-0 flex items-center gap-2 px-2 py-1 text-xs text-text-muted/70 bg-bg-tertiary/60 rounded-tl rounded-tr z-10">
        <span>{language}</span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            copy(codeString)
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-text-primary p-0.5"
          title="Copy code"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      {showSyntaxHighlighting && html ? (
        <div className="min-w-0" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="overflow-x-auto">
          <pre className="my-0 px-4 py-3 overflow-x-auto font-mono text-sm whitespace-pre-wrap break-word">
            <code className={`language-${language}`}>{codeString}</code>
          </pre>
        </div>
      )}
    </div>
  )
})

function createMarkdownComponents(muted: boolean, showSyntaxHighlighting: boolean) {
  const headingColor = muted ? 'text-text-muted' : 'text-text-heading'
  const strongColor = muted ? 'text-text-secondary' : 'text-text-bold'

  return {
    code({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'>) {
      const match = /language-(\w+)/.exec(className || '')
      const isInline = !match && !String(children).includes('\n')

      if (isInline) {
        const color = muted ? 'text-text-muted' : 'text-text-code'
        return (
          <code className={`bg-bg-tertiary px-1 py-0.5 rounded ${color} font-mono text-xs`} {...props}>
            {children}
          </code>
        )
      }

      const language = match?.[1] || 'text'
      const codeString = String(children).replace(/\n$/, '')

      return <CodeBlock language={language} codeString={codeString} showSyntaxHighlighting={showSyntaxHighlighting} />
    },

    p({ children }: { children?: React.ReactNode }) {
      const color = muted ? 'text-text-muted' : 'text-text-primary'
      return <p className={`${color} mb-1.5 last:mb-0 leading-tight break-words`}>{children}</p>
    },

    ul({ children }: { children?: React.ReactNode }) {
      return <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>
    },

    ol({ children }: { children?: React.ReactNode }) {
      return <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>
    },

    li({ children }: { children?: React.ReactNode }) {
      const color = muted ? 'text-text-muted' : 'text-text-primary'
      return <li className={`${color} text-sm list-item`}>{children}</li>
    },

    h1({ children }: { children?: React.ReactNode }) {
      return <h1 className={`text-base font-bold mb-1.5 mt-2 first:mt-0 ${headingColor}`}>{children}</h1>
    },

    h2({ children }: { children?: React.ReactNode }) {
      return <h2 className={`text-sm font-bold mb-1.5 mt-2 first:mt-0 ${headingColor}`}>{children}</h2>
    },

    h3({ children }: { children?: React.ReactNode }) {
      return <h3 className={`text-sm font-bold mb-1.5 mt-1.5 first:mt-0 ${headingColor}`}>{children}</h3>
    },

    h4({ children }: { children?: React.ReactNode }) {
      return <h4 className={`text-sm font-bold mb-1.5 mt-1.5 first:mt-0 ${headingColor}`}>{children}</h4>
    },

    strong({ children }: { children?: React.ReactNode }) {
      return <strong className={`font-bold ${strongColor}`}>{children}</strong>
    },

    em({ children }: { children?: React.ReactNode }) {
      return <em className={muted ? 'italic text-text-secondary' : 'italic'}>{children}</em>
    },

    a({ href, children }: { href?: string; children?: React.ReactNode }) {
      return (
        <a href={href} className="text-text-link hover:underline text-sm" target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )
    },

    blockquote({ children }: { children?: React.ReactNode }) {
      const color = muted ? 'text-text-muted' : 'text-text-secondary'
      return (
        <blockquote className={`border-l-2 border-accent-primary pl-2 my-1.5 ${color} italic text-sm`}>
          {children}
        </blockquote>
      )
    },

    table({ children }: { children?: React.ReactNode }) {
      return (
        <div className="overflow-x-auto my-1.5">
          <table className="min-w-full border border-border">{children}</table>
        </div>
      )
    },

    th({ children }: { children?: React.ReactNode }) {
      return (
        <th className="border border-border bg-bg-tertiary px-2 py-1 text-left font-semibold text-sm">{children}</th>
      )
    },

    td({ children }: { children?: React.ReactNode }) {
      return <td className="border border-border px-2 py-1 text-sm">{children}</td>
    },

    hr() {
      return <hr className="border-border my-2" />
    },

    input({ checked, ...props }: React.ComponentPropsWithoutRef<'input'>) {
      return <input type="checkbox" checked={checked} disabled className="mr-1.5 w-3.5 h-3.5" {...props} />
    },
  }
}

// Memoize to prevent re-renders during streaming from causing flicker
export const Markdown = memo(function Markdown({ content, className = '', muted = false }: MarkdownProps) {
  const { showSyntaxHighlighting } = useDisplaySettings()

  // Preprocess markdown to fix common LLM formatting quirks
  const processedContent = useMemo(() => {
    let processed = preprocessMarkdown(content)
    processed = fixUnclosedCodeBlocks(processed)
    return processed
  }, [content])

  const components = useMemo(
    () => createMarkdownComponents(muted, showSyntaxHighlighting),
    [muted, showSyntaxHighlighting],
  )

  return (
    <div className={`markdown-content [&_li>p]:inline ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processedContent}
      </ReactMarkdown>
    </div>
  )
})

/**
 * Preprocess markdown to fix common LLM formatting issues:
 * - Unicode bullets (•) → markdown bullets (-)
 * - Numbered items with content on next line (1.\n**text**) → same line (1. **text**)
 * - Table pipes on separate lines → join with previous line
 * - Strip line numbers from read_file output (e.g., "123: | Path" → "| Path")
 */
function preprocessMarkdown(content: string): string {
  // Convert Unicode bullets to markdown list markers
  let processed = content.replace(/^(\s*)•\s/gm, '$1- ')

  // Fix numbered list items where content is on the next line
  // e.g., "1.\n**verifier**" → "1. **verifier**"
  processed = processed.replace(/^(\d+)\.\s*\n(?=\S)/gm, '$1. ')

  // Fix table pipes at start of lines by removing pipe-only lines
  // This handles broken table formatting where LLM puts | on its own line
  processed = processed.replace(/^\|\s*$/gm, '')

  // Strip line numbers added by read_file tool (format: "123|content")
  processed = processed.replace(/^\d+\|/gm, '')

  return processed
}

/**
 * Fix unclosed code blocks during streaming.
 * This prevents raw markdown backticks from showing while the model
 * is still typing a code block.
 */
function fixUnclosedCodeBlocks(content: string): string {
  // Count occurrences of code block delimiters
  const codeBlockRegex = /```/g
  const matches = content.match(codeBlockRegex)
  const count = matches?.length ?? 0

  // If odd number of ```, we have an unclosed code block
  if (count % 2 === 1) {
    // Check if the last ``` has a language specifier on the same line
    const lastIndex = content.lastIndexOf('```')
    const afterBackticks = content.slice(lastIndex + 3)
    const hasNewlineAfter = afterBackticks.includes('\n')

    if (hasNewlineAfter) {
      // Code block is open with content, close it
      return content + '\n```'
    } else {
      // Still typing language specifier or just opened, add newline and close
      return content + '\n```'
    }
  }

  return content
}
