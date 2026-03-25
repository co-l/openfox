import { memo } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

// Custom oneDark theme with transparent backgrounds and word wrapping
export const oneDarkTransparent: Record<string, any> = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...(oneDark['pre[class*="language-"]'] as Record<string, unknown>),
    background: 'transparent',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    overflowX: 'hidden',
  },
  'code[class*="language-"]': {
    ...(oneDark['code[class*="language-"]'] as Record<string, unknown>),
    background: 'transparent',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  },
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

export function getLanguageFromPath(filePath?: string): string {
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

// Style objects for SyntaxHighlighter customStyle prop
const codeStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  borderRadius: 0,
  fontSize: '0.875rem',    // 14px to match text-sm
  lineHeight: '1.5rem',    // 24px for consistent line alignment
  background: 'transparent',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
}

const inlineCodeStyle: React.CSSProperties = {
  ...codeStyle,
  display: 'inline',
}

export const wrappedCodeStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  borderRadius: 0,
  fontSize: '0.875rem',
  lineHeight: '1.5rem',
  background: 'transparent',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
}

interface CodeHighlightProps {
  code: string
  language: string
  variant: 'block' | 'block-nowrap' | 'inline'
}

export const CodeHighlight = memo(function CodeHighlight({ code, language, variant }: CodeHighlightProps) {
  const preTag = variant === 'inline' ? 'span' : variant === 'block-nowrap' ? 'div' : 'pre'
  const style = variant === 'inline' ? inlineCodeStyle : variant === 'block-nowrap' ? codeStyle : wrappedCodeStyle

  return (
    <SyntaxHighlighter
      style={oneDarkTransparent}
      language={language}
      PreTag={preTag}
      customStyle={style}
    >
      {code}
    </SyntaxHighlighter>
  )
})
