import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface MarkdownProps {
  content: string
  className?: string
}

// Memoize to prevent re-renders during streaming from causing flicker
export const Markdown = memo(function Markdown({ content, className = '' }: MarkdownProps) {
  // For streaming: if we have an unclosed code block, close it temporarily
  // This prevents raw markdown from showing during streaming
  const processedContent = useMemo(() => {
    return fixUnclosedCodeBlocks(content)
  }, [content])

  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Code blocks with syntax highlighting
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const isInline = !match && !String(children).includes('\n')
            
            if (isInline) {
              return (
                <code
                  className="bg-bg-tertiary px-1.5 py-0.5 rounded text-accent-secondary font-mono text-sm"
                  {...props}
                >
                  {children}
                </code>
              )
            }
            
            const language = match?.[1] || 'text'
            const codeString = String(children).replace(/\n$/, '')
            
            return (
              <div className="relative group my-2">
                <div className="absolute top-0 right-0 px-2 py-1 text-xs text-text-muted bg-bg-tertiary rounded-bl">
                  {language}
                </div>
                <SyntaxHighlighter
                  style={oneDark}
                  language={language}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    borderRadius: '0.5rem',
                    fontSize: '0.875rem',
                  } as React.CSSProperties}
                >
                  {codeString}
                </SyntaxHighlighter>
              </div>
            )
          },
        
        // Style other elements
        p({ children }) {
          return <p className="mb-2 last:mb-0">{children}</p>
        },
        
        ul({ children }) {
          return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>
        },
        
        ol({ children }) {
          return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>
        },
        
        li({ children }) {
          return <li className="text-text-primary">{children}</li>
        },
        
        h1({ children }) {
          return <h1 className="text-xl font-bold mb-2 mt-4 first:mt-0 text-sky-400">{children}</h1>
        },
        
        h2({ children }) {
          return <h2 className="text-lg font-bold mb-2 mt-3 first:mt-0 text-sky-400">{children}</h2>
        },
        
        h3({ children }) {
          return <h3 className="text-base font-bold mb-2 mt-2 first:mt-0 text-sky-400">{children}</h3>
        },
        
        h4({ children }) {
          return <h4 className="text-sm font-bold mb-2 mt-2 first:mt-0 text-sky-400">{children}</h4>
        },
        
        strong({ children }) {
          return <strong className="font-bold text-amber-400">{children}</strong>
        },
        
        a({ href, children }) {
          return (
            <a
              href={href}
              className="text-accent-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          )
        },
        
        blockquote({ children }) {
          return (
            <blockquote className="border-l-4 border-accent-primary pl-4 my-2 text-text-secondary italic">
              {children}
            </blockquote>
          )
        },
        
        table({ children }) {
          return (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full border border-border">{children}</table>
            </div>
          )
        },
        
        th({ children }) {
          return (
            <th className="border border-border bg-bg-tertiary px-3 py-2 text-left font-semibold">
              {children}
            </th>
          )
        },
        
        td({ children }) {
          return <td className="border border-border px-3 py-2">{children}</td>
        },
        
        hr() {
          return <hr className="border-border my-4" />
        },
        
        // Task list items (GFM)
        input({ checked, ...props }) {
          return (
            <input
              type="checkbox"
              checked={checked}
              disabled
              className="mr-2"
              {...props}
            />
          )
        },
      }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
})

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
