import { memo, useEffect, useState, useRef } from 'react'
import { highlightCode, useShikiTheme } from '../../lib/syntax-highlighter'
import { useDisplaySettings } from '../../hooks/useDisplaySettings'

interface CodeHighlightProps {
  code: string
  language: string
  variant: 'block' | 'block-nowrap' | 'inline'
  showLineNumbers?: boolean
  startLine?: number
}

function PlainCode({ code, variant }: { code: string; variant: CodeHighlightProps['variant'] }) {
  const Tag = variant === 'inline' ? 'span' : variant === 'block-nowrap' ? 'div' : 'pre'
  return (
    <Tag className="language-">
      <code className="language-">{code}</code>
    </Tag>
  )
}

export const CodeHighlight = memo(function CodeHighlight({
  code,
  language,
  variant,
  showLineNumbers = false,
  startLine = 1,
}: CodeHighlightProps) {
  const { showSyntaxHighlighting } = useDisplaySettings()
  const [html, setHtml] = useState<string | null>(null)
  const shikiTheme = useShikiTheme()
  const latestCodeRef = useRef(code)

  useEffect(() => {
    if (!showSyntaxHighlighting) return
    latestCodeRef.current = code
    highlightCode(code, language, shikiTheme).then((result) => {
      if (latestCodeRef.current === code) {
        setHtml(result)
      }
    })
  }, [code, language, shikiTheme, showSyntaxHighlighting])

  if (!showSyntaxHighlighting || !html) {
    return <PlainCode code={code} variant={variant} />
  }

  if (variant === 'inline') {
    return <span dangerouslySetInnerHTML={{ __html: html }} />
  }

  const className = showLineNumbers ? '' : 'shiki-plain'
  return (
    <div
      className={className}
      style={{ '--shiki-start': startLine } as React.CSSProperties}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})
