// PrismLight with selective language registration.
// Reduces bundle size by ~200-300KB compared to the full Prism build.
// Unregistered languages fall back to plain text rendering.

import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

// Register commonly used languages
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import html from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import cLang from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby'
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml'
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss'
import graphql from 'react-syntax-highlighter/dist/esm/languages/prism/graphql'
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker'

SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('jsx', jsx)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('html', html)
SyntaxHighlighter.registerLanguage('markup', html)
SyntaxHighlighter.registerLanguage('xml', html)
SyntaxHighlighter.registerLanguage('sql', sql)
SyntaxHighlighter.registerLanguage('yaml', yaml)
SyntaxHighlighter.registerLanguage('markdown', markdown)
SyntaxHighlighter.registerLanguage('diff', diff)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('java', java)
SyntaxHighlighter.registerLanguage('c', cLang)
SyntaxHighlighter.registerLanguage('cpp', cpp)
SyntaxHighlighter.registerLanguage('ruby', ruby)
SyntaxHighlighter.registerLanguage('toml', toml)
SyntaxHighlighter.registerLanguage('scss', scss)
SyntaxHighlighter.registerLanguage('graphql', graphql)
SyntaxHighlighter.registerLanguage('docker', docker)

export { SyntaxHighlighter, oneDark }
