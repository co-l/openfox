/**
 * Shared shell parsing helpers.
 *
 * Two questions are answered here, both about the *same* distinction:
 *
 * - which commands does a command line actually run? (`splitShellCommands`)
 * - which parts of a command line are code, and which are literal data?
 *   (`scanExecutableSurfaces`)
 *
 * The distinction matters for the safety guards: `grep -R 'sudo ' docs/`
 * searches for the word "sudo", while `echo "$(sudo whoami)"` really runs
 * sudo. Quoted text is data; command substitutions, `sh -c` payloads and
 * `eval` arguments are code.
 */

/** One word of a shell command, with its quoting resolved. */
export interface ShellWord {
  /** Raw text of the word, quotes included. */
  raw: string
  /** Word content with the surrounding quotes removed. */
  value: string
  /** True when the whole word was quoted, so the shell treats it as literal data. */
  quoted: boolean
  /** Part of the word the shell would actually execute (empty for pure literals). */
  executable: string
}

/** One command of a command line, split on shell operators. */
export interface ShellCommand {
  /** Raw text of the command, quotes included. */
  raw: string
  /** Text the shell would execute: unquoted words plus redirect targets. */
  executable: string
  /** Words of the command, quote-aware. */
  words: ShellWord[]
}

/** A piece of a word: literal (quoted) or executable (unquoted). */
interface WordPiece {
  text: string
  literal: boolean
}

/** Shell operators that end one command and start the next. */
const COMMAND_SEPARATORS = new Set([';', '&', '|', '\n', '(', ')'])

/** Shell operators that redirect a command's output or input. */
const REDIRECT_OPERATORS = new Set(['>', '<', '>>', '<<', '>&', '<&', '>|'])

/** Shells that execute the string given to their `-c` option. */
export const SHELL_COMMANDS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])

/**
 * Find the index just after the closing delimiter of a nested construct.
 *
 * @param src - Source text
 * @param start - Index of the opening delimiter
 * @param open - Opening delimiter
 * @param close - Closing delimiter
 * @returns Index just after the closing delimiter, or -1 when unbalanced
 */
function findClosing(src: string, start: number, open: string, close: string): number {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < src.length; i++) {
    const ch = src[i]!
    if (quote !== null) {
      if (ch === '\\' && quote !== "'") {
        i += 1
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === open) depth += 1
    if (ch === close) {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * A command substitution found in a command line.
 */
interface Substitution {
  /** The text the substitution runs. */
  body: string
  /** Index just after the substitution in the source text. */
  end: number
}

/**
 * Read the command substitution that starts at `index`.
 *
 * Handles both `$(...)` and backticks.
 *
 * @param src - Source text
 * @param index - Index of the `$` or the backtick
 * @returns The substitution and its end index, or null when there is none
 */
function readSubstitution(src: string, index: number): Substitution | null {
  const ch = src[index]!
  if (ch === '$' && src[index + 1] === '(') {
    const end = findClosing(src, index + 1, '(', ')')
    if (end === -1) return null
    return { body: src.slice(index + 2, end - 1), end }
  }
  if (ch === '`') {
    const close = src.indexOf('`', index + 1)
    const stop = close === -1 ? src.length : close
    return { body: src.slice(index + 1, stop), end: close === -1 ? src.length : close + 1 }
  }
  return null
}

/**
 * Split a command line into the commands it actually runs.
 *
 * Shell operators (`;`, `&&`, `||`, `|`, `&`, newlines, subshells) separate
 * commands. Command substitutions (`$(...)` and backticks) are analysed as the
 * commands they run, and are reported as separate commands. Quoted text stays
 * part of the command that contains it.
 */
export function splitShellCommands(command: string): ShellCommand[] {
  const segments: ShellCommand[] = []
  let current: ShellWord[] = []
  let pieces: WordPiece[] = []
  let wordStart = 0
  let i = 0
  let redirectPending = false

  const pushWord = (end: number, isRedirectTarget: boolean): void => {
    if (pieces.length === 0) return
    const value = pieces.map((piece) => piece.text).join('')
    const executable = pieces
      .filter((piece) => !piece.literal)
      .map((piece) => piece.text)
      .join('')
    // A redirect target is a path the shell really opens: keep it even when quoted.
    const effectiveExecutable = isRedirectTarget ? value : executable
    current.push({
      raw: command.slice(wordStart, end),
      value,
      quoted: pieces.every((piece) => piece.literal),
      executable: effectiveExecutable,
    })
    pieces = []
  }

  const endCommand = (): void => {
    if (current.length === 0) return
    segments.push({
      raw: current.map((word) => word.raw).join(' '),
      executable: current
        .map((word) => word.executable)
        .filter((text) => text.length > 0)
        .join(' '),
      words: current,
    })
    current = []
  }

  while (i < command.length) {
    const ch = command[i]!

    if (ch === ' ' || ch === '\t' || ch === '\n') {
      pushWord(i, redirectPending)
      redirectPending = false
      i += 1
      wordStart = i
      continue
    }

    if (ch === "'") {
      const end = command.indexOf("'", i + 1)
      const stop = end === -1 ? command.length : end
      pieces.push({ text: command.slice(i + 1, stop), literal: true })
      i = end === -1 ? command.length : end + 1
      continue
    }

    if (ch === '"') {
      let j = i + 1
      while (j < command.length) {
        const cur = command[j]!
        if (cur === '\\' && j + 1 < command.length) {
          pieces.push({ text: command.slice(j + 1, j + 2), literal: false })
          j += 2
          continue
        }
        if (cur === '$' && command[j + 1] === '(') {
          const end = findClosing(command, j + 1, '(', ')')
          if (end === -1) {
            pieces.push({ text: command.slice(j + 1), literal: false })
            j = command.length
            continue
          }
          segments.push(...splitShellCommands(command.slice(j + 2, end - 1)))
          j = end
          continue
        }
        if (cur === '`') {
          const end = command.indexOf('`', j + 1)
          const stop = end === -1 ? command.length : end
          segments.push(...splitShellCommands(command.slice(j + 1, stop)))
          j = end === -1 ? command.length : end + 1
          continue
        }
        if (cur === '$') {
          // A variable expansion inside double quotes: the text it expands to
          // is only known at run time, so the word is kept as an executable
          // placeholder rather than being treated as literal data.
          const match = /^\$[A-Za-z_][A-Za-z0-9_]*|^\$\{[A-Za-z_][A-Za-z0-9_]*\}/.exec(command.slice(j))
          if (match) {
            pieces.push({ text: match[0], literal: false })
            j += match[0].length
            continue
          }
        }
        if (cur === '"') {
          j += 1
          break
        }
        pieces.push({ text: cur, literal: true })
        j += 1
      }
      i = j
      continue
    }

    if (ch === '$' || ch === '`') {
      const substitution = readSubstitution(command, i)
      if (!substitution) {
        // A bare variable expansion (`$VAR`, `${VAR}`, `$1`, `$?`) is code
        // whose value is only known at run time: keep it as an executable
        // placeholder and keep scanning so the rest of the line stays visible.
        const expansion = /^\$[A-Za-z_][A-Za-z0-9_]*|^\$\{[^}]*\}|^\$[0-9@*#?$!-]/.exec(command.slice(i))
        if (expansion) {
          pieces.push({ text: expansion[0], literal: false })
          i += expansion[0].length
          continue
        }
        pieces.push({ text: '$', literal: false })
        i += 1
        continue
      }
      segments.push(...splitShellCommands(substitution.body))
      i = substitution.end
      wordStart = i
      continue
    }

    if (REDIRECT_OPERATORS.has(ch)) {
      pushWord(i, redirectPending)
      redirectPending = true
      let op = ch
      let j = i + 1
      if ((ch === '>' || ch === '<') && command[j] === ch) {
        op = ch + ch
        j += 1
      }
      pieces.push({ text: op, literal: false })
      i = j
      wordStart = i
      continue
    }

    if (ch === '&' && command[i + 1] === '>') {
      pushWord(i, redirectPending)
      redirectPending = true
      pieces.push({ text: '&>', literal: false })
      i += 2
      wordStart = i
      continue
    }

    if (COMMAND_SEPARATORS.has(ch)) {
      pushWord(i, redirectPending)
      redirectPending = false
      endCommand()
      i += 1
      wordStart = i
      continue
    }

    pieces.push({ text: ch, literal: false })
    i += 1
  }

  pushWord(command.length, redirectPending)
  endCommand()

  return segments.filter((segment) => segment.words.length > 0)
}

/**
 * Index of the word that carries the `-c` option of a shell command.
 *
 * The option may stand alone (`sh -c`), be part of a short-option cluster
 * (`sh -lc`) or follow other flags (`sh -x -c`).
 *
 * @param words - Words of the shell command
 * @param from - Index of the shell command word
 * @returns Index of the option word, or -1 when there is none
 */
export function findShellCommandOption(words: ShellWord[], from: number): number {
  return words.findIndex((word, position) => {
    if (position <= from) return false
    const value = word.value
    if (!value.startsWith('-') || value === '-') return false
    if (value.startsWith('--')) return false
    // Short-option cluster: `sh -lc` carries `-c` among its letters.
    return value.slice(1).includes('c')
  })
}

/**
 * Strip a directory prefix and a Windows executable suffix from a command
 * word: "/usr/bin/git" -> "git", "powershell.exe" -> "powershell".
 *
 * Windows paths may use a backslash separator, and an executable path may
 * contain spaces: "C:\Program Files\Git\bin\git.exe".
 */
export function commandBasename(word: string): string {
  const slash = Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\'))
  const base = slash >= 0 ? word.slice(slash + 1) : word
  // Windows executables carry an `.exe` suffix: `cmd.exe`, `powershell.exe`.
  if (base.toLowerCase().endsWith('.exe')) {
    return base.slice(0, -'.exe'.length)
  }
  return base
}

/**
 * Commands whose argument is a command string the shell executes.
 *
 * For those, a quoted argument is code, not data: `sudo "rm -rf ~/"` and
 * `sh -c "git clean -fd"` really run the quoted text.
 */
const COMMAND_EXECUTORS = new Set([
  'bash',
  'chrt',
  'cmd',
  'command',
  'csh',
  'dash',
  'doas',
  'env',
  'eval',
  'exec',
  'fish',
  'ionice',
  'ksh',
  'nice',
  'node',
  'nohup',
  'perl',
  'php',
  'powershell',
  'pwsh',
  'python',
  'python3',
  'ruby',
  'setsid',
  'sh',
  'ssh',
  'stdbuf',
  'su',
  'sudo',
  'taskset',
  'tcsh',
  'time',
  'timeout',
  'watch',
  'xargs',
  'zsh',
])

/**
 * Commands that run another command, and whose quoted argument is that
 * command.
 *
 * They are not interpreters — their payload is a command line, not source
 * code — but they execute it, so a quoted argument must be scanned as code:
 * `docker run --rm alpine "rm -rf ~/"` really runs the quoted command.
 */
const COMMAND_RUNNERS = new Set(['docker', 'kubectl', 'make', 'nsenter', 'parallel', 'podman', 'systemd-run'])

/**
 * Commands whose quoted arguments are DATA, never commands.
 *
 * A search pattern or a message is text, not code: `grep -rn "rm -rf" docs/`
 * must not be read as a destructive command.
 */
export const DATA_ONLY_COMMANDS = new Set([
  'ack',
  'ag',
  'apropos',
  'awk',
  'cat',
  'echo',
  'egrep',
  'fgrep',
  'gawk',
  'grep',
  'head',
  'less',
  'man',
  'mawk',
  'more',
  'nawk',
  'printf',
  'rg',
  'sed',
  'tail',
  'tee',
  'tr',
  'type',
  'wc',
  'whereis',
  'which',
])

/** awk-family interpreters whose quoted program is code. */
const AWK_COMMANDS = new Set(['awk', 'gawk', 'mawk', 'nawk'])

/**
 * Options that carry a command string for an interpreter.
 *
 * python/ruby/node take `-c`, perl takes `-e`, ssh takes the remote command
 * as its trailing argument.
 */
const INTERPRETER_COMMAND_OPTIONS = new Set(['-c', '-e', '--eval', '-E'])

/**
 * Interpreters whose payload is source code, not a shell command line.
 *
 * In `python -c "os.system('rm -rf ~/')"` the quoted text is Python source:
 * the inner `'rm -rf ~/'` is a string the program executes, not a shell
 * word. Such a payload is therefore scanned as raw text, not as shell.
 */
const SOURCE_INTERPRETERS = new Set(['node', 'perl', 'php', 'python', 'python3', 'ruby'])

/**
 * True when a word is an option that carries a command string.
 *
 * @param value - The raw word
 */
function isCommandOption(value: string): boolean {
  // cmd.exe uses `/c` and `/k`.
  if (value === '/c' || value === '/k') return true
  if (!value.startsWith('-')) return false
  if (value.startsWith('--')) {
    const name = value.slice(2).split('=')[0]!.toLowerCase()
    return name === 'command' || name === 'c' || name === 'encodedcommand'
  }
  const body = value.slice(1)
  // A short-option cluster: `-lc` carries `-c`.
  if (body.length <= 2) return body.includes('c')
  // A single-dash long option: `-Command`.
  return body.toLowerCase().startsWith('c')
}

/**
 * A command string a segment really executes.
 */
export interface CommandPayload {
  /** The text the executor runs. */
  text: string
  /**
   * True when the text is interpreter source code rather than a shell command
   * line: in `python -c "os.system('rm -rf ~/')"` the inner quoted text is a
   * string the program executes, not a shell word.
   */
  source: boolean
  /**
   * True when the text contains a shell variable expansion, so the command it
   * runs is only known at run time: `sh -c "$CMD"`.
   */
  dynamic: boolean
}

/**
 * True when a text contains a shell variable expansion.
 *
 * `sh -c "$CMD"` runs whatever `$CMD` holds: the command is only known at
 * run time, so the text cannot be trusted to describe what runs.
 */
export function hasVariableExpansion(text: string): boolean {
  return /\$[A-Za-z_{0-9@*#?$!-]/.test(text)
}

/** True when a text references a named shell variable (`$VAR`, `${VAR}`). */
function hasNamedExpansion(text: string): boolean {
  return /\$[A-Za-z_{]/.test(text)
}

/** True when a word is a shell `NAME=value` assignment. */
function isAssignmentWord(word: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)
}

/**
 * True when an awk program can run a command: `system(...)`, a pipe to a
 * command (`print | "cmd"`, `cmd | getline`), or a runtime environment lookup.
 * A plain `print`/`printf` without a pipe is data.
 */
function awkExecutesCommands(program: string): boolean {
  return (
    /\bsystem\s*\(/.test(program) ||
    /\|\s*getline\b/.test(program) ||
    /\b(print|printf)\s*\|/.test(program) ||
    /\bENVIRON\b/.test(program)
  )
}

/**
 * True when a sed script can run a command: the `e` command (optionally
 * preceded by an address) or the `e` flag of a substitution. Plain
 * substitutions and prints are data.
 */
function sedExecutesCommands(script: string): boolean {
  if (/(^|[;{}\n])\s*(?:\d+|\$|\/[^/\n]*\/)?\s*e(\s|$)/.test(script)) return true
  return /s(.).*?\1.*?\1[a-zA-Z]*e[a-zA-Z]*(\s*;|\s*$)/.test(script)
}

/**
 * Find the inline awk/sed programs and any runtime sources.
 *
 * `sed -e` carries the script; `awk -v name=value` values can hold the command
 * a `system(...)`/pipe runs, so they are scanned as sources too. `-f` names a
 * script file, not inline code.
 */
function findInterpreterSources(
  words: ShellWord[],
  start: number,
  command: 'awk' | 'sed',
): { programs: string[]; sources: string[]; dynamicPrograms: string[] } {
  const programs: string[] = []
  const sources: string[] = []
  const dynamicPrograms: string[] = []
  const valueOptions = command === 'awk' ? new Set(['-v', '-F', '-f']) : new Set(['-e', '-f'])
  let sawInline = false
  for (let j = start + 1; j < words.length; j++) {
    const word = words[j]!
    const value = word.value
    if (value.startsWith('-') && value !== '-') {
      if (valueOptions.has(value)) {
        const next = words[j + 1]
        if (command === 'sed' && value === '-e' && next) programs.push(next.value)
        if (command === 'awk' && value === '-v' && next) sources.push(next.value)
        j += 1
      }
      continue
    }
    if (sawInline) continue
    if (word.quoted) {
      programs.push(value)
      sawInline = true
    } else if (hasVariableExpansion(value)) {
      // A program that is only known at run time (`awk "$PROG"`).
      dynamicPrograms.push(value)
      sawInline = true
    }
  }
  return { programs, sources, dynamicPrograms }
}

/**
 * Options that carry a value in the next word.
 *
 * `docker run --env "FOO=bar" alpine "rm -rf ~/"` puts the image name after
 * the option value: the quoted option value is not the command.
 */
const OPTIONS_WITH_VALUE = new Set([
  '--chdir',
  '--env',
  '--env-file',
  '--entrypoint',
  '--file',
  '--log-level',
  '--network',
  '--output',
  '--volume',
  '-f',
  '-w',
])

/**
 * True when a word is an option that carries a value in the next word.
 */
function isValueOption(word: string): boolean {
  if (!word.startsWith('-') || word === '-' || word === '--') return false
  const name = word.includes('=') ? word.slice(0, word.indexOf('=')) : word
  return OPTIONS_WITH_VALUE.has(name)
}

/**
 * Find the command strings a segment really executes.
 *
 * A command string is the argument of a command executor: the payload of a
 * shell's `-c` option, of `cmd /c`, of `powershell -Command`, of an
 * interpreter's `-c`/`-e`, of `eval`, the remote command of `ssh`, or a
 * quoted argument given to a wrapper such as `sudo`.
 *
 * @param segment - One command of a command line
 * @returns The command strings the segment executes
 */
/**
 * Indices of the words a runner executes as a command, based on its
 * subcommand grammar:
 *   docker/podman run IMAGE CMD, docker/podman exec CONTAINER CMD,
 *   docker compose run SERVICE CMD, kubectl exec POD -- CMD,
 *   nsenter ... CMD, systemd-run CMD, parallel CMD...
 * Other subcommands (`docker logs`, `docker pull`, `docker build`,
 * `kubectl get`) take operands, not a command.
 */
function runnerCommandIndices(words: ShellWord[], start: number, name: string): number[] {
  const operands: number[] = []
  let afterDoubleDash = -1
  for (let j = start + 1; j < words.length; j++) {
    const value = words[j]!.value
    if (value === '--') {
      afterDoubleDash = j
      continue
    }
    if (value.startsWith('-') && value !== '-') {
      if (isValueOption(value)) j += 1
      continue
    }
    const previous = words[j - 1]?.value
    const precededByOption =
      previous !== undefined &&
      previous.startsWith('-') &&
      previous !== '-' &&
      previous !== '--' &&
      !previous.includes('=')
    if (precededByOption) continue
    operands.push(j)
  }
  if (afterDoubleDash !== -1) return [afterDoubleDash + 1]
  const sub = operands[0] !== undefined ? words[operands[0]]!.value : ''
  if (name === 'docker' || name === 'podman') {
    if (sub === 'run' || sub === 'exec') return operands[2] !== undefined ? [operands[2]] : []
    if (sub === 'compose') {
      const composeSub = operands[1] !== undefined ? words[operands[1]]!.value : ''
      if (composeSub === 'run' || composeSub === 'exec') return operands[3] !== undefined ? [operands[3]] : []
    }
    return []
  }
  if (name === 'kubectl') {
    if (sub === 'exec' || sub === 'run') return operands[2] !== undefined ? [operands[2]] : []
    return []
  }
  if (name === 'parallel') return operands
  // nsenter, systemd-run, make: the first operand is the program/target.
  return operands[0] !== undefined ? [operands[0]] : []
}

export function findCommandPayloads(segment: ShellCommand): CommandPayload[] {
  const payloads: CommandPayload[] = []
  const words = segment.words

  for (let i = 0; i < words.length; i++) {
    const name = commandBasename(words[i]!.value)
    // awk and sed programs are code: when they execute a command
    // (`system(...)`, a pipe, the `e` command/flag) the program is scanned as
    // raw source text. Plain substitutions/prints stay data.
    if (AWK_COMMANDS.has(name) || name === 'sed') {
      const family = name === 'sed' ? 'sed' : 'awk'
      const { programs, sources, dynamicPrograms } = findInterpreterSources(words, i, family)
      if (dynamicPrograms.length > 0) {
        for (const program of dynamicPrograms) {
          payloads.push({ text: program, source: true, dynamic: true })
        }
        continue
      }
      const executes = programs.some((program) =>
        family === 'awk'
          ? awkExecutesCommands(program) || hasNamedExpansion(program)
          : sedExecutesCommands(program) || hasNamedExpansion(program),
      )
      if (executes) {
        for (const program of programs) {
          const runs = family === 'awk' ? awkExecutesCommands(program) : sedExecutesCommands(program)
          const dynamic = hasNamedExpansion(program) || /\bENVIRON\b/.test(program)
          if (!runs && !dynamic) continue
          payloads.push({ text: program, source: true, dynamic })
        }
        // `awk -v name=value` can carry the command a pipe/system() runs.
        for (const source of sources) {
          payloads.push({ text: source, source: true, dynamic: hasNamedExpansion(source) })
        }
      }
      continue
    }
    const isExecutor = COMMAND_EXECUTORS.has(name)
    const isRunner = COMMAND_RUNNERS.has(name)
    if (!isExecutor && !isRunner) continue
    // `docker exec` / `kubectl exec`: `exec` is a subcommand of the runner, not
    // the shell builtin. The runner's own iteration handles the operands.
    if (isExecutor && i > 0 && COMMAND_RUNNERS.has(commandBasename(words[i - 1]!.value))) continue
    // A search or text tool takes data, never a command.
    if (DATA_ONLY_COMMANDS.has(name)) continue

    if (name === 'eval') {
      // `eval` runs everything that follows.
      const rest = words
        .slice(i + 1)
        .map((word) => word.value)
        .join(' ')
      if (rest.length > 0) {
        payloads.push({ text: rest, source: false, dynamic: hasVariableExpansion(rest) })
      }
      continue
    }

    if (name === 'ssh') {
      // `ssh host "command"` runs the quoted string on the remote host. A
      // quoted option value (`-o "Opt=val"`) is data; every other quoted word
      // is a candidate command (the host itself may be quoted). A non-quoted
      // word with a variable expansion (`ssh host "$CMD"`) is a runtime
      // command and fails closed. Scanning all of them stops a quoted host
      // from shadowing the remote command.
      const args = words.slice(i + 1)
      for (let j = 0; j < args.length; j++) {
        const word = args[j]!
        const previous = j > 0 ? args[j - 1]?.value : words[i]?.value
        const precededByOption =
          previous !== undefined &&
          previous.startsWith('-') &&
          previous !== '-' &&
          previous !== '--' &&
          !previous.includes('=')
        if (precededByOption) continue
        if (word.quoted) {
          payloads.push({ text: word.value, source: false, dynamic: hasNamedExpansion(word.value) })
        } else if (hasVariableExpansion(word.value)) {
          payloads.push({ text: word.value, source: false, dynamic: true })
        }
      }
      continue
    }

    // Which options take a value is not enumerable, so a quoted word that
    // directly follows an option (`-u "root"`, `--name "my app"`) is treated
    // as that option's value, not as the command. Every quoted word in command
    // position is scanned (the command is not necessarily the first one); when
    // every quoted word follows an option (a no-value flag such as `sudo -n`
    // right before the command), the last quoted word is used so the payload
    // is never lost.
    const isInterpreter = SOURCE_INTERPRETERS.has(name)
    const commandCandidates: ShellWord[] = []
    const quotedWords: ShellWord[] = []
    let foundCommandOption = false
    let commandSeen = false
    const runnerCommandIdx = isRunner ? new Set(runnerCommandIndices(words, i, name)) : null
    for (let j = i + 1; j < words.length; j++) {
      const candidate = words[j]!
      const value = candidate.value
      // A known value option consumes the next word.
      if (isValueOption(value)) {
        j += 1
        continue
      }
      // A runner (`docker`, `kubectl`, …) does not use `-c` to carry a command
      // string: only shells and interpreters do.
      if (!isRunner && (isCommandOption(value) || (isInterpreter && INTERPRETER_COMMAND_OPTIONS.has(value)))) {
        const payload = words[j + 1]
        if (!payload) break
        const text = payload.quoted
          ? payload.value
          : words
              .slice(j + 1)
              .map((word) => word.value)
              .join(' ')
        payloads.push({
          text,
          source: SOURCE_INTERPRETERS.has(name),
          dynamic: hasVariableExpansion(text),
        })
        foundCommandOption = true
        break
      }
      if (value === '--') continue
      const previous = words[j - 1]?.value
      const precededByOption =
        previous !== undefined &&
        previous.startsWith('-') &&
        previous !== '-' &&
        previous !== '--' &&
        !previous.includes('=')
      // The wrapped command is a text tool (`sudo echo "…"`): its quoted
      // arguments are data, not a command string.
      if (
        !precededByOption &&
        !candidate.quoted &&
        !value.startsWith('-') &&
        DATA_ONLY_COMMANDS.has(commandBasename(value))
      ) {
        break
      }
      // A command word that is only known at run time cannot be classified:
      // fail closed. For a wrapper/shell only the command word (before any
      // other command/script word) counts. For a runner the subcommand grammar
      // says which word is the command (`docker run IMAGE CMD`, `kubectl exec
      // POD -- CMD`), so operands like `docker run -u "$USER"` or
      // `docker logs "$C"` are not mistaken for commands.
      if (
        !isAssignmentWord(value) &&
        !value.startsWith('-') &&
        hasVariableExpansion(value) &&
        (isRunner ? (runnerCommandIdx?.has(j) ?? false) : !commandSeen)
      ) {
        payloads.push({ text: value, source: false, dynamic: true })
        foundCommandOption = true
        break
      }
      if (!candidate.quoted) {
        if (!precededByOption && !value.startsWith('-')) commandSeen = true
        continue
      }
      quotedWords.push(candidate)
      if (!precededByOption) {
        commandCandidates.push(candidate)
        commandSeen = true
      }
    }
    if (foundCommandOption) continue
    // Scan every quoted word in command position: the command is not
    // necessarily the first one (`parallel "echo hi" "sudo x"`), and a quoted
    // argument after it must not shadow a dangerous earlier word.
    if (commandCandidates.length > 0) {
      for (const candidate of commandCandidates) {
        payloads.push({
          text: candidate.value,
          source: false,
          dynamic: hasVariableExpansion(candidate.value),
        })
      }
    } else {
      const fallback = quotedWords[quotedWords.length - 1]
      if (fallback) {
        payloads.push({ text: fallback.value, source: false, dynamic: hasVariableExpansion(fallback.value) })
      }
    }
  }

  return payloads
}

/**
 * True when a command runs a command string that is only known at run time
 * (a variable expansion in command position, or an awk/sed program that
 * executes a runtime command). Both guards fail closed on such input.
 *
 * @param command - The command line to inspect
 */
export function hasUnresolvedExecution(command: string): boolean {
  for (const segment of splitShellCommands(command)) {
    if (findCommandPayloads(segment).some((payload) => payload.dynamic)) return true
    // A command word that is a variable expansion (`$CMD`) is only known at
    // run time.
    const words = segment.words
    let index = 0
    while (index < words.length && isAssignmentWord(words[index]!.value)) index += 1
    const commandWord = words[index]?.value
    if (commandWord !== undefined && hasVariableExpansion(commandWord)) return true
  }
  return false
}

/**
 * Scan a command line for the parts the shell actually executes.
 *
 * The first surface is the command line with every quoted literal removed:
 * what is left is code. Command substitutions, `sh -c` payloads and `eval`
 * arguments are code too, and are returned as additional surfaces — they are
 * scanned as they are, because inside them quoting again separates data from
 * code.
 *
 * @param command - The command line to scan
 * @returns The executable surfaces, in the order the shell reaches them
 */
export function scanExecutableSurfaces(command: string): string[] {
  const surfaces: string[] = []

  // The command line is scanned segment by segment: a quoted literal is
  // dropped from the segment that holds it, but the segments that follow it
  // are still scanned (`echo "$HOME"; rm -rf ~/` keeps the `rm -rf ~/`).
  for (const segment of splitShellCommands(command)) {
    surfaces.push(segment.executable)
  }

  // Command strings a segment really executes are code, not data: the payload
  // of a shell's `-c`, of `cmd /c`, of `powershell -Command`, of `eval`, or a
  // quoted argument given to a wrapper such as `sudo`.
  for (const segment of splitShellCommands(command)) {
    for (const payload of findCommandPayloads(segment)) {
      if (payload.source) {
        // Interpreter source: the quoted text inside it is a string the
        // program executes, so the whole payload is scanned as raw text.
        surfaces.push(payload.text)
        continue
      }
      surfaces.push(...scanExecutableSurfaces(payload.text))
    }
  }

  return surfaces
}
