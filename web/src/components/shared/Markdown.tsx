import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SyntaxHighlighter, oneDark } from '../../lib/syntax-highlighter'

interface MarkdownProps {
  content: string
  className?: string
}

// Static components object — hoisted to module scope so ReactMarkdown
// receives a referentially stable prop and skips internal reconciliation.
const MARKDOWN_COMPONENTS = {
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '')
    const isInline = !match && !String(children).includes('\n')

    if (isInline) {
      return (
        <code
          className="bg-bg-tertiary px-1 py-0.5 rounded text-accent-secondary font-mono text-xs"
          {...props}
        >
          {children}
        </code>
      )
    }

    const language = match?.[1] || 'text'
    const codeString = String(children).replace(/\n$/, '')

    return (
      <div className="relative group my-1.5">
        <div className="absolute top-0 right-0 px-1.5 py-0.5 text-[10px] text-text-muted bg-bg-tertiary rounded-bl">
          {language}
        </div>
        <SyntaxHighlighter
          style={oneDark}
          language={language}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: '0.375rem',
            fontSize: '0.75rem',
          } as React.CSSProperties}
        >
          {codeString}
        </SyntaxHighlighter>
      </div>
    )
  },

  p({ children }: any) {
    return <p className="mb-1.5 last:mb-0 leading-tight">{children}</p>
  },

  ul({ children }: any) {
    return <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>
  },

  ol({ children }: any) {
    return <ol className="list-decimal list-inside mb-1.5 space-y-0.5">{children}</ol>
  },

  li({ children }: any) {
    return <li className="text-text-primary text-sm list-item">{children}</li>
  },

  h1({ children }: any) {
    return <h1 className="text-base font-bold mb-1.5 mt-2 first:mt-0 text-sky-400">{children}</h1>
  },

  h2({ children }: any) {
    return <h2 className="text-sm font-bold mb-1.5 mt-2 first:mt-0 text-sky-400">{children}</h2>
  },

  h3({ children }: any) {
    return <h3 className="text-sm font-bold mb-1.5 mt-1.5 first:mt-0 text-sky-400">{children}</h3>
  },

  h4({ children }: any) {
    return <h4 className="text-sm font-bold mb-1.5 mt-1.5 first:mt-0 text-sky-400">{children}</h4>
  },

  strong({ children }: any) {
    return <strong className="font-bold text-amber-400">{children}</strong>
  },

  a({ href, children }: any) {
    return (
      <a
        href={href}
        className="text-accent-primary hover:underline text-sm"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    )
  },

  blockquote({ children }: any) {
    return (
      <blockquote className="border-l-2 border-accent-primary pl-2 my-1.5 text-text-secondary italic text-sm">
        {children}
      </blockquote>
    )
  },

  table({ children }: any) {
    return (
      <div className="overflow-x-auto my-1.5">
        <table className="min-w-full border border-border">{children}</table>
      </div>
    )
  },

  th({ children }: any) {
    return (
      <th className="border border-border bg-bg-tertiary px-2 py-1 text-left font-semibold text-sm">
        {children}
      </th>
    )
  },

  td({ children }: any) {
    return <td className="border border-border px-2 py-1 text-sm">{children}</td>
  },

  hr() {
    return <hr className="border-border my-2" />
  },

  input({ checked, ...props }: any) {
    return (
      <input
        type="checkbox"
        checked={checked}
        disabled
        className="mr-1.5 w-3.5 h-3.5"
        {...props}
      />
    )
  },
}

// Memoize to prevent re-renders during streaming from causing flicker
export const Markdown = memo(function Markdown({ content, className = '' }: MarkdownProps) {
  // Preprocess markdown to fix common LLM formatting quirks
  const processedContent = useMemo(() => {
    let processed = preprocessMarkdown(content)
    processed = fixUnclosedCodeBlocks(processed)
    return processed
  }, [content])

  return (
    <div className={`markdown-content [&_li>p]:inline ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
})

/**
 * Preprocess markdown to fix common LLM formatting issues:
 * - Unicode bullets (•) → markdown bullets (-)
 * - Numbered items with content on next line (1.\n**text**) → same line (1. **text**)
 */
function preprocessMarkdown(content: string): string {
  // Convert Unicode bullets to markdown list markers
  let processed = content.replace(/^(\s*)•\s/gm, '$1- ')

  // Fix numbered list items where content is on the next line
  // e.g., "1.\n**verifier**" → "1. **verifier**"
  processed = processed.replace(/^(\d+)\.\s*\n(?=\S)/gm, '$1. ')

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
