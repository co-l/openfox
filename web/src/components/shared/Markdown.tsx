import { memo, useMemo, useEffect, useState, useRef } from 'react'
import { OptionalScrollArea } from './OptionalScrollArea'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightCode, useShikiTheme, warmUpHighlighter } from '../../lib/syntax-highlighter'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard'
import { CheckIcon, CopyIcon } from './icons'
import { useT } from '../../hooks/useT'

interface MarkdownProps {
  content: string
  className?: string
  muted?: boolean
  isStreaming?: boolean
}

// Blocks larger than this are rendered without shiki (tool outputs, dumps).
const SKIP_HIGHLIGHT_THRESHOLD = 5000

// Minimum delay between two highlights of a code block that keeps growing
// (streaming). The text itself is never delayed, only its colors.
const STREAMING_HIGHLIGHT_INTERVAL_MS = 400

const SHIKI_LAST_LINE_END = '</span></code></pre>'

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Append not-yet-highlighted text to shiki html, keeping its structure: the
 * first line of `tail` continues the last highlighted line, each further line
 * becomes its own `.line` (block-level, numbered by CSS). Returns null when the
 * html does not have the expected shape, so the caller falls back to plain text.
 */
function appendPlainTail(html: string, tail: string): string | null {
  const end = html.lastIndexOf(SHIKI_LAST_LINE_END)
  if (end === -1) return null
  const [first = '', ...rest] = tail.split('\n')
  const newLines = rest.map((line) => `\n<span class="line">${escapeHtml(line)}</span>`).join('')
  return `${html.slice(0, end)}${escapeHtml(first)}</span>${newLines}</code></pre>${html.slice(end + SHIKI_LAST_LINE_END.length)}`
}

// Cache the parsed markdown output per content string + render options.
// Non-streaming messages are immutable, so re-parsing them on every re-render
// (session switch, theme change, unrelated state updates) wastes main-thread
// CPU. Keyed by content + options — cheap string compare, no hashing needed.
// Bounded both by entry count and by total key+content bytes: large tool
// outputs can each weigh hundreds of KB.
const markdownRenderCache = new Map<string, React.ReactNode>()
const MARKDOWN_CACHE_MAX = 100
const MARKDOWN_CACHE_MAX_BYTES = 20 * 1024 * 1024
let markdownCacheMaxBytes = MARKDOWN_CACHE_MAX_BYTES
let markdownCacheBytes = 0

// Exposed for tests: verifies the byte-bounded eviction without parsing tens
// of MB of markdown.
export function getMarkdownCacheBytesForTest(): number {
  return markdownCacheBytes
}

// Exposed for tests: shrinking the budget is what lets the eviction be proven
// with a few hundred KB instead of the 24MB the real budget would demand.
// Call with no argument to restore the production value.
export function setMarkdownCacheMaxBytesForTest(bytes = MARKDOWN_CACHE_MAX_BYTES): void {
  markdownCacheMaxBytes = bytes
}

function cacheMarkdown(key: string, node: React.ReactNode): React.ReactNode {
  markdownRenderCache.set(key, node)
  markdownCacheBytes += key.length
  while (markdownRenderCache.size > MARKDOWN_CACHE_MAX || markdownCacheBytes > markdownCacheMaxBytes) {
    const firstKey = markdownRenderCache.keys().next().value
    if (firstKey === undefined) break
    markdownRenderCache.delete(firstKey)
    markdownCacheBytes -= firstKey.length
  }
  return node
}

const CodeBlock = memo(function CodeBlock({
  language,
  codeString,
  showSyntaxHighlighting,
  deferHighlight,
}: {
  language: string
  codeString: string
  showSyntaxHighlighting: boolean
  deferHighlight: boolean
}) {
  const t = useT()
  const { copied, copy } = useCopyToClipboard()
  const shikiTheme = useShikiTheme()
  // `source` is the code the html was produced for; `key` ties it to the
  // language and theme so a theme switch re-highlights.
  const [highlighted, setHighlighted] = useState<{ key: string; source: string; html: string } | null>(null)
  const latestCodeRef = useRef(codeString)
  // Last highlight started (code + time), whether or not it has resolved yet.
  const lastRequestRef = useRef<{ key: string; source: string; at: number } | null>(null)

  // Skip shiki for plain-text blocks (no syntax to highlight) and for very
  // large blocks (tool outputs, read_file dumps): highlighting tens of
  // thousands of characters costs seconds of main-thread CPU for no benefit.
  const skipHighlight = language === 'text' || codeString.length > SKIP_HIGHLIGHT_THRESHOLD
  const key = `${language}|${shikiTheme}`
  const current = highlighted?.key === key ? highlighted : null

  latestCodeRef.current = codeString

  useEffect(() => {
    if (!showSyntaxHighlighting || deferHighlight || skipHighlight) return
    if (current?.source === codeString) return

    const run = () => {
      lastRequestRef.current = { key, source: codeString, at: Date.now() }
      highlightCode(codeString, language, shikiTheme).then((html) => {
        // Keep a result as long as it still describes the start of the block:
        // while streaming, the block has usually grown past it by the time it
        // resolves, and dropping it would leave the block unhighlighted.
        if (!latestCodeRef.current.startsWith(codeString)) return
        setHighlighted((previous) =>
          previous?.key === key && previous.source.length > codeString.length && previous.source.startsWith(codeString)
            ? previous
            : { key, source: codeString, html },
        )
      })
    }

    // A block that only grows is being streamed. shiki re-highlights the whole
    // block every time, so doing it on every frame is the main streaming cost
    // on slow devices: throttle it. Meanwhile the new text is shown as plain
    // lines after the highlighted part (appendPlainTail).
    const last = lastRequestRef.current
    const growing = last !== null && last.key === key && codeString.startsWith(last.source)
    const wait = growing ? last.at + STREAMING_HIGHLIGHT_INTERVAL_MS - Date.now() : 0
    if (wait <= 0) {
      run()
      return
    }
    const timer = setTimeout(run, wait)
    return () => clearTimeout(timer)
  }, [codeString, key, language, shikiTheme, showSyntaxHighlighting, deferHighlight, skipHighlight, current])

  const html =
    current === null
      ? null
      : current.source === codeString
        ? current.html
        : codeString.startsWith(current.source)
          ? appendPlainTail(current.html, codeString.slice(current.source.length))
          : null

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
          title={t({ en: 'Copy code', fr: 'Copier le code' })}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      {showSyntaxHighlighting && html ? (
        <div className="min-w-0" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <OptionalScrollArea horizontal scope="codeBlocks">
          <pre className="my-0 px-4 py-3 font-mono text-sm whitespace-pre-wrap break-word">
            <code className={`language-${language}`}>{codeString}</code>
          </pre>
        </OptionalScrollArea>
      )}
    </div>
  )
})

function createMarkdownComponents(muted: boolean, showSyntaxHighlighting: boolean, deferHighlight: boolean) {
  const headingColor = muted ? 'text-text-muted' : 'text-text-heading'
  const strongColor = muted ? 'text-text-secondary' : 'text-text-bold'

  return {
    code({ className, children, node: _node, ...props }: React.ComponentPropsWithoutRef<'code'> & { node?: unknown }) {
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

      return (
        <CodeBlock
          language={language}
          codeString={codeString}
          showSyntaxHighlighting={showSyntaxHighlighting}
          deferHighlight={deferHighlight}
        />
      )
    },

    p({ children }: { children?: React.ReactNode }) {
      const color = muted ? 'text-text-muted' : 'text-text-primary'
      return <p className={`${color} mb-1.5 last:mb-0 leading-tight break-words`}>{children}</p>
    },

    ul({ children }: { children?: React.ReactNode }) {
      return <ul className="list-disc list-inside mb-1.5 space-y-0.5">{children}</ul>
    },

    ol({ start, children }: { start?: number; children?: React.ReactNode }) {
      return (
        <ol start={start} className="list-decimal list-inside mb-1.5 space-y-0.5">
          {children}
        </ol>
      )
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
        <OptionalScrollArea horizontal className="my-1.5" scope="codeBlocks">
          <table className="min-w-full border border-border">{children}</table>
        </OptionalScrollArea>
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
export const Markdown = memo(function Markdown({
  content,
  className = '',
  muted = false,
  isStreaming = false,
}: MarkdownProps) {
  const { showSyntaxHighlighting, deferCodeHighlightWhileStreaming } = useDisplaySettings()

  // Compile the common languages while the page is idle, before a code block
  // needs them (runs once per page).
  useEffect(() => {
    if (showSyntaxHighlighting) warmUpHighlighter()
  }, [showSyntaxHighlighting])

  // While streaming, defer syntax highlighting while a code block is still open
  // (odd number of ``` fences) so the block is not re-highlighted on every frame.
  // Opt-in: default keeps code highlighted progressively as it streams in; the
  // deferral trades that for smoother streaming at the cost of one paint at the end.
  const deferCodeHighlight = useMemo(
    () => isStreaming && deferCodeHighlightWhileStreaming && countCodeFences(content) % 2 === 1,
    [isStreaming, deferCodeHighlightWhileStreaming, content],
  )

  const components = useMemo(
    () => createMarkdownComponents(muted, showSyntaxHighlighting, deferCodeHighlight),
    [muted, showSyntaxHighlighting, deferCodeHighlight],
  )

  // Non-streaming messages are immutable: cache the parsed tree per content so
  // re-renders (session switches, sidebar updates) don't re-parse markdown.
  // CodeBlock manages its own shiki theme, so theme changes stay correct.
  // The cache key includes the render options (muted, syntax highlighting):
  // the same content can legitimately render in different contexts.
  const body = useMemo(() => {
    const processed = preprocessForRender(content)
    if (!containsMarkdownSyntax(processed)) {
      if (!processed.trim()) return null
      const color = muted ? 'text-text-muted' : 'text-text-primary'
      return (
        <p className={`${color} mb-1.5 last:mb-0 leading-tight break-words whitespace-pre-line`}>
          {linkifyBareUrls(processed)}
        </p>
      )
    }
    if (isStreaming) {
      // Re-parsing the whole message on every streamed frame makes each frame
      // cost O(message length). Parse block by block instead: finished blocks
      // keep their content, so their memoized parse is reused and only the block
      // still being written is parsed again. Once streaming ends, the message is
      // parsed as a whole (below), exactly as before.
      return splitMarkdownBlocks(processed).map((block, index) => (
        <MarkdownBlock key={index} content={block} components={components} />
      ))
    }
    return getCachedMarkdown(processed, components, muted, showSyntaxHighlighting)
  }, [content, isStreaming, components, muted, showSyntaxHighlighting])

  return <div className={`markdown-content [&_li>p]:inline ${className}`}>{body}</div>
})

function preprocessForRender(content: string): string {
  let processed = preprocessMarkdown(content)
  processed = fixUnclosedCodeBlocks(processed)
  return processed.trimEnd()
}

// Linkify bare http(s) URLs in plain-text content, matching what remark-gfm
// autolinking would do for the markdown path.
function linkifyBareUrls(text: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} className="text-text-link hover:underline" target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  )
}

// Conservative check: any markdown-ish construct routes to the full parser,
// so the plain fast path only handles genuinely plain prose.
function containsMarkdownSyntax(content: string): boolean {
  return (
    content.includes('`') ||
    content.includes('~') ||
    content.includes('<') ||
    /^#{1,6}\s/m.test(content) ||
    /^\s*[-*+]\s/m.test(content) ||
    /^\s*\d+[.)]\s/m.test(content) ||
    /^\s*>\s?/m.test(content) ||
    /^\s*\|.*\|/m.test(content) ||
    /^\s*([-*_])\1{2,}\s*$/m.test(content) ||
    /\[[^\]]*\]\([^)]*\)/.test(content) ||
    /!\[[^\]]*\]/.test(content) ||
    /[*_]/.test(content) ||
    content.includes('&')
  )
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/

/**
 * Split markdown into top-level blocks that parse the same on their own: a new
 * block starts at a non-indented line following a blank line, outside fenced
 * code. Indented lines stay with their block (list item paragraphs, nested
 * content). The blocks join back to the input. The only construct parsed
 * differently is a loose list (items separated by blank lines), which becomes
 * consecutive lists; ordered ones keep their numbering through `start`.
 */
export function splitMarkdownBlocks(content: string): string[] {
  const blocks: string[] = []
  const lines = content.split('\n')
  let current = ''
  let fence: { char: string; length: number } | null = null
  let afterBlank = false

  lines.forEach((line, index) => {
    const text = index < lines.length - 1 ? `${line}\n` : line
    if (fence) {
      const marker = FENCE_CLOSE.exec(line)?.[1]
      if (marker && marker[0] === fence.char && marker.length >= fence.length) fence = null
      current += text
      return
    }
    if (afterBlank && /^\S/.test(line) && current.trim()) {
      blocks.push(current)
      current = ''
    }
    const opening = FENCE_OPEN.exec(line)?.[1]
    if (opening) fence = { char: opening[0] ?? '`', length: opening.length }
    afterBlank = line.trim() === ''
    current += text
  })
  if (current) blocks.push(current)
  return blocks
}

/** One independently parsed block of a streaming message; memoized on its content. */
const MarkdownBlock = memo(function MarkdownBlock({
  content,
  components,
}: {
  content: string
  components: ReturnType<typeof createMarkdownComponents>
}) {
  return renderMarkdown(content, components)
})

function renderMarkdown(content: string, components: ReturnType<typeof createMarkdownComponents>): React.ReactNode {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  )
}

function getCachedMarkdown(
  content: string,
  components: ReturnType<typeof createMarkdownComponents>,
  muted: boolean,
  showSyntaxHighlighting: boolean,
): React.ReactNode {
  const key = `${muted ? 'm' : 'n'}|${showSyntaxHighlighting ? 'h' : 'p'}|${content}`
  const cached = markdownRenderCache.get(key)
  if (cached !== undefined) return cached
  const node = renderMarkdown(content, components)
  return cacheMarkdown(key, node)
}

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

  // Separate numbered lists that continue a previous section without a blank line.
  // CommonMark only lets "1." interrupt a paragraph — a list continuing at "3."
  // right after a paragraph line would otherwise collapse into it (renders inline).
  processed = separateDetachedNumberedLists(processed)

  return processed
}

/**
 * Insert a blank line before numbered list markers that follow a paragraph line.
 * CommonMark only allows "1." to interrupt a paragraph; a list continuing at
 * "3." (or any N > 1) directly after a paragraph would merge into that
 * paragraph and render inline. Lines inside fenced code blocks are left alone.
 */
function separateDetachedNumberedLists(content: string): string {
  // Early-out: most content has no line-start numbered marker, so skip the
  // split/scan/join pass entirely (it would otherwise run on every streaming frame).
  if (!/^\d+[.)] /m.test(content)) return content
  const lines = content.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence || i === 0) continue
    const prev = lines[i - 1]
    if (prev === undefined) continue
    if (/^\d+[.)] /.test(line) && prev.trim() !== '' && !/^\s*(?:[-*+]\s|\d+[.)] )/.test(prev)) {
      lines[i - 1] = prev + '\n'
    }
  }
  return lines.join('\n')
}

function countCodeFences(content: string): number {
  return content.match(/```/g)?.length ?? 0
}

/**
 * Fix unclosed code blocks during streaming.
 * This prevents raw markdown backticks from showing while the model
 * is still typing a code block.
 */
function fixUnclosedCodeBlocks(content: string): string {
  // Count occurrences of code block delimiters
  const count = countCodeFences(content)

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
