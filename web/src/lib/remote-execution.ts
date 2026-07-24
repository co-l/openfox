export type RemoteProtocol = 'SSH' | 'SCP' | 'SFTP' | 'MOSH'

const remoteExecutables: Record<string, RemoteProtocol> = {
  ssh: 'SSH',
  scp: 'SCP',
  sftp: 'SFTP',
  mosh: 'MOSH',
}

const sudoOptionsWithValue = new Set([
  '-C',
  '--close-from',
  '-D',
  '--chdir',
  '-g',
  '--group',
  '-h',
  '--host',
  '-p',
  '--prompt',
  '-R',
  '--chroot',
  '-T',
  '--command-timeout',
  '-u',
  '--user',
])
const envOptionsWithValue = new Set(['-C', '--chdir', '-S', '--split-string', '-u', '--unset'])

function executableName(token: string): string {
  return token.split(/[\\/]/).pop() ?? token
}

interface Heredoc {
  delimiter: string
  stripTabs: boolean
  expandable: boolean
}

function findHeredocs(line: string): Heredoc[] {
  const heredocs: Heredoc[] = []
  let quote: "'" | '"' | null = null
  let escaped = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (char === "'" || char === '"') {
      quote = quote === char ? null : quote === null ? char : quote
      continue
    }
    if (quote) continue
    if (char === '#' && (index === 0 || /\s|[;&|(){}]/.test(line[index - 1]!))) break
    if (char !== '<' || line[index - 1] === '<' || line[index + 1] !== '<' || line[index + 2] === '<') continue

    let cursor = index + 2
    const stripTabs = line[cursor] === '-'
    if (stripTabs) cursor += 1
    while (/\s/.test(line[cursor] ?? '')) cursor += 1
    let delimiter = ''
    let wordQuote: "'" | '"' | null = null
    let ansiCQuote = false
    let expandable = true
    while (cursor < line.length) {
      const current = line[cursor]!
      if (!wordQuote && /\s|[;&|(){}<>]/.test(current)) break
      if (current === "'" || current === '"') {
        expandable = false
        if (wordQuote === current) {
          wordQuote = null
          ansiCQuote = false
        } else if (wordQuote === null) {
          wordQuote = current
        }
        cursor += 1
        continue
      }
      if (!wordQuote && current === '$' && line[cursor + 1] === "'") {
        expandable = false
        ansiCQuote = true
        wordQuote = "'"
        cursor += 2
        continue
      }
      if (current === '\\' && cursor + 1 < line.length) {
        expandable = false
        if (ansiCQuote) {
          const escape = line.slice(cursor).match(/^\\(?:x([0-9A-Fa-f]{1,2})|([0-7]{1,3})|([abefnrtv\\'"?]))/)
          if (escape) {
            if (escape[1]) delimiter += String.fromCharCode(Number.parseInt(escape[1], 16))
            else if (escape[2]) delimiter += String.fromCharCode(Number.parseInt(escape[2], 8))
            else {
              const simple: Record<string, string> = {
                a: '\x07',
                b: '\b',
                e: '\x1b',
                f: '\f',
                n: '\n',
                r: '\r',
                t: '\t',
                v: '\v',
              }
              delimiter += simple[escape[3]!] ?? escape[3]!
            }
            cursor += escape[0].length
            continue
          }
        }
        if (wordQuote !== '"' || ['$', '`', '"', '\\', '\n'].includes(line[cursor + 1]!)) {
          cursor += 1
        }
      }
      delimiter += line[cursor]!
      cursor += 1
    }
    if (delimiter) heredocs.push({ delimiter, stripTabs, expandable })
    index = cursor
  }

  return heredocs
}

function stripHeredocBodies(command: string): { command: string; expandableBodies: string[] } {
  const lines = command.split('\n')
  const result: string[] = []
  const expandableBodies: string[] = []
  const pending: Heredoc[] = []

  for (const line of lines) {
    if (pending.length > 0) {
      const current = pending[0]!
      const candidate = current.stripTabs ? line.replace(/^\t+/, '') : line
      if (candidate === current.delimiter) pending.shift()
      else if (current.expandable) expandableBodies.push(candidate)
      continue
    }

    result.push(line)
    pending.push(...findHeredocs(line))
  }

  return { command: result.join('\n'), expandableBodies }
}

function extractCommandSubstitutions(command: string, respectComments = true): string[] {
  const substitutions: string[] = []
  let quote: "'" | '"' | null = null
  let escaped = false
  let comment = false
  let wordStarted = false

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!
    if (comment) {
      if (char === '\n' || char === '\r') comment = false
      continue
    }
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      wordStarted = true
      escaped = true
      continue
    }
    if (char === "'") {
      wordStarted = true
      quote = quote === "'" ? null : quote === null ? "'" : quote
      continue
    }
    if (char === '"') {
      wordStarted = true
      quote = quote === '"' ? null : quote === null ? '"' : quote
      continue
    }
    if (quote === "'") continue
    if (!quote && /\s|[;&|(){}]/.test(char)) wordStarted = false
    else if (char !== '#') wordStarted = true
    if (respectComments && char === '#' && !wordStarted) {
      comment = true
      continue
    }

    if (char === '`') {
      const end = command.indexOf('`', index + 1)
      if (end !== -1) {
        substitutions.push(command.slice(index + 1, end))
        index = end
      }
      continue
    }

    if (char === '$' && command[index + 1] === '(' && command[index + 2] !== '(') {
      let depth = 1
      let innerQuote: "'" | '"' | null = null
      let innerEscaped = false
      for (let end = index + 2; end < command.length; end += 1) {
        const inner = command[end]!
        if (innerEscaped) {
          innerEscaped = false
          continue
        }
        if (inner === '\\' && innerQuote !== "'") {
          innerEscaped = true
          continue
        }
        if (inner === "'" || inner === '"') {
          innerQuote = innerQuote === inner ? null : innerQuote === null ? inner : innerQuote
          continue
        }
        if (innerQuote) continue
        if (inner === '(') depth += 1
        if (inner === ')') depth -= 1
        if (depth === 0) {
          substitutions.push(command.slice(index + 2, end))
          index = end
          break
        }
      }
    }
  }

  return substitutions
}

function tokenize(command: string): string[] {
  const tokens: string[] = []
  let token = ''
  let tokenStarted = false
  let quote: "'" | '"' | null = null
  let escaped = false
  let comment = false

  const flush = () => {
    if (tokenStarted) tokens.push(token)
    token = ''
    tokenStarted = false
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!
    if (comment) {
      if (char === '\n' || char === '\r') {
        comment = false
        if (tokens.at(-1) !== ';') tokens.push(';')
      }
      continue
    }
    if (escaped) {
      tokenStarted = true
      token += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else token += char
      continue
    }
    if (char === "'" || char === '"') {
      tokenStarted = true
      quote = char
      continue
    }
    if (char === '$' && command.slice(index, index + 3) === '$((') {
      let depth = 1
      const start = index
      for (let end = index + 3; end < command.length - 1; end += 1) {
        if (command.slice(end, end + 2) === '((') depth += 1
        if (command.slice(end, end + 2) === '))') depth -= 1
        if (depth === 0) {
          tokenStarted = true
          token += command.slice(start, end + 2)
          index = end + 1
          break
        }
      }
      continue
    }
    if (char === '#' && !tokenStarted) {
      comment = true
      continue
    }
    if (/\s/.test(char)) {
      flush()
      if (char === '\n' || char === '\r') tokens.push(';')
      continue
    }
    if (char === ';' || char === '|' || char === '&' || char === '(' || char === ')' || char === '{' || char === '}') {
      flush()
      const next = command[index + 1]
      if (next === char) index += 1
      tokens.push(char)
      continue
    }
    tokenStarted = true
    token += char
  }
  if (escaped) token += '\\'
  flush()
  return tokens
}

function skipOptions(tokens: string[], index: number, optionsWithValue: Set<string>): number {
  while (index < tokens.length) {
    const option = tokens[index]!
    if (option === '--') return index + 1
    if (!option.startsWith('-') || option === '-') return index
    index += 1
    if (!option.includes('=') && optionsWithValue.has(option)) index += 1
  }
  return index
}

function detectSegment(tokens: string[], depth = 0): RemoteProtocol | null {
  if (depth > 8) return null

  let index = 0
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]!)) index += 1

  const initialExecutable = executableName(tokens[index] ?? '').toLowerCase()
  if (initialExecutable === 'env') {
    for (let optionIndex = index + 1; optionIndex < tokens.length; optionIndex += 1) {
      const option = tokens[optionIndex]!
      if (option === '-S' || option === '--split-string') {
        const script = tokens[optionIndex + 1]
        return script ? detectRemoteCommand(script, depth + 1) : null
      }
      const splitString = option.match(/^--split-string=(.*)$/s)
      if (splitString) return detectRemoteCommand(splitString[1]!, depth + 1)
    }
    index = skipOptions(tokens, index + 1, envOptionsWithValue)
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]!)) index += 1
    return detectSegment(tokens.slice(index), depth + 1)
  }

  if (initialExecutable === 'sudo') {
    index = skipOptions(tokens, index + 1, sudoOptionsWithValue)
    return detectSegment(tokens.slice(index), depth + 1)
  }

  const executable = initialExecutable
  const remote = remoteExecutables[executable]
  if (remote) return remote

  if (executable === 'command') {
    if (tokens.slice(index + 1).some((token) => token === '-v' || token === '-V')) return null
    const commandIndex = skipOptions(tokens, index + 1, new Set())
    return detectSegment(tokens.slice(commandIndex), depth + 1)
  }

  if (executable === 'setsid' || executable === 'nohup') {
    const commandIndex = skipOptions(tokens, index + 1, new Set())
    return detectSegment(tokens.slice(commandIndex), depth + 1)
  }

  if (executable === 'timeout') {
    const durationIndex = skipOptions(tokens, index + 1, new Set(['-k', '--kill-after', '-s', '--signal']))
    return detectSegment(tokens.slice(durationIndex + 1), depth + 1)
  }

  if (executable === 'bash' || executable === 'sh' || executable === 'zsh' || executable === 'fish') {
    for (let optionIndex = index + 1; optionIndex < tokens.length; optionIndex += 1) {
      const option = tokens[optionIndex]!
      if (option === '--') continue
      if (/^-[^-]*n/.test(option)) return null
      if (/^-[^-]*c/.test(option)) {
        const delimiterOffset = tokens[optionIndex + 1] === '--' ? 2 : 1
        const script = tokens[optionIndex + delimiterOffset]
        return script ? detectRemoteCommand(script, depth + 1) : null
      }
      if (!option.startsWith('-')) break
    }
  }

  return null
}

export function detectRemoteCommand(command: string, depth = 0): RemoteProtocol | null {
  if (depth > 8) return null
  const { command: executableCommand, expandableBodies } = stripHeredocBodies(command)
  const substitutions = [
    ...extractCommandSubstitutions(executableCommand),
    ...expandableBodies.flatMap((body) => extractCommandSubstitutions(body, false)),
  ]
  for (const substitution of substitutions) {
    const detected = detectRemoteCommand(substitution, depth + 1)
    if (detected) return detected
  }
  const tokens = tokenize(executableCommand)
  let segment: string[] = []

  const boundaries = new Set([';', '|', '&', '(', ')', '{', '}'])
  const controlPrefixes = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until'])
  let skipLoopHeader = false
  let inCase = false

  for (const token of tokens) {
    if (token === 'for' || token === 'select') {
      const detected = detectSegment(segment, depth)
      if (detected) return detected
      segment = []
      skipLoopHeader = true
      continue
    }
    if (token === 'case') {
      const detected = detectSegment(segment, depth)
      if (detected) return detected
      segment = []
      inCase = true
      continue
    }
    if (skipLoopHeader) {
      if (token === 'do') skipLoopHeader = false
      continue
    }
    if (inCase && token === ')') {
      segment = []
      continue
    }
    if (boundaries.has(token)) {
      const detected = detectSegment(segment, depth)
      if (detected) return detected
      segment = []
    } else if (controlPrefixes.has(token)) {
      const detected = detectSegment(segment, depth)
      if (detected) return detected
      segment = []
    } else if (token === 'fi' || token === 'done' || token === 'esac') {
      const detected = detectSegment(segment, depth)
      if (detected) return detected
      segment = []
      if (token === 'esac') inCase = false
    } else {
      segment.push(token)
    }
  }

  return detectSegment(segment, depth)
}

export function detectRemoteExecution(tool: string, args: Record<string, unknown>): RemoteProtocol | null {
  if (tool !== 'run_command' || typeof args.command !== 'string') return null
  return detectRemoteCommand(args.command)
}
