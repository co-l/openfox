import { resolve, isAbsolute } from 'node:path'
import stripAnsi from 'strip-ansi'
import { OUTPUT_LIMITS } from './types.js'
import { createTool, requestUserConfirmation } from './tool-helpers.js'
import { serverT } from '../i18n.js'
import { checkAborted, spawnShellProcess } from '../utils/shell.js'
import { createUtf8StreamDecoder } from '../utils/utf8.js'
import {
  extractAbsolutePathsFromCommand,
  extractSensitivePathsFromCommand,
  resolveRelativeTraversals,
} from './path-security.js'
import { terminateProcessTree } from '../utils/process-tree.js'
import { stripTailPipe } from './shell-tail.js'

/**
 * Check if a command performs a Git mutation that changes branches or workspace state.
 * Does NOT strip quotes — doing so would let git "checkout" main bypass detection.
 */
export function detectGitMutation(command: string): string | null {
  // Check for git commands with mutation verbs (on the raw command, no quote stripping)
  const gitMatch = command.match(
    /\bgit\s+['"]?(?:checkout|switch|branch\s+(-[dDmcMC]|--delete|--move|--copy|--force|-f)|-b\s+\S+|merge|rebase|reset|cherry-pick|worktree|clone|pull|push|fetch|update-ref|symbolic-ref)/,
  )
  if (gitMatch) {
    return gitMatch[0].trim()
  }

  return null
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  let m = Math.floor(ms / 60_000)
  let s = Math.round((ms % 60_000) / 1000)
  if (s === 60) {
    m += 1
    s = 0
  }
  return `${m}m ${s}s`
}

export function hasBackgroundAmpersand(command: string): boolean {
  // Strip content inside quotes — & inside quotes is literal, not a background operator
  let processed = command.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ')

  // Strip escaped characters — \& is a literal ampersand
  processed = processed.replace(/\\./g, '  ')

  // Replace multi-character operators that contain & but aren't background operators
  processed = processed.replace(/&&/g, '  ') // logical AND
  processed = processed.replace(/\|&/g, '   ') // stderr pipe
  processed = processed.replace(/&>/g, '  ') // redirect both stdout+stderr
  processed = processed.replace(/>&\d/g, '   ') // fd redirect (e.g. 2>&1)
  processed = processed.replace(/>&/g, '  ') // other >& redirect forms

  // Any remaining & is a background operator
  return processed.includes('&')
}

interface RunCommandArgs {
  command: string
  cwd?: string
  timeout?: number
}

export const runCommandTool = createTool<RunCommandArgs>(
  'run_command',
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Execute a shell command. Returns stdout, stderr, exit code, and elapsed duration. Does NOT support trailing "&" for backgrounding — use background_process tool instead.\nCommands run from your working directory automatically, so prefer relative paths.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to execute',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the command (default: session workdir)',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 120000)',
          },
        },
        required: ['command'],
      },
    },
  },
  async (args, context, helpers) => {
    const timeout = args.timeout ?? 120_000

    if (hasBackgroundAmpersand(args.command)) {
      return helpers.error(
        // LLM-facing (rendered into the tool content) — English by design.
        'Use background_process tool (action: "start") for background/long-running commands instead of \'&\'. See the tool description for details.',
      )
    }

    // Detect Git mutations (checkout, switch, branch creation, etc.)
    const mutationMatch = detectGitMutation(args.command)
    if (mutationMatch) {
      const desc = serverT(
        {
          en: 'Command "{{cmd}}" modifies Git state ({{mutation}}). Allow this Git operation?',
          fr: 'La commande « {{cmd}} » modifie l’état Git ({{mutation}}). Autoriser cette opération Git ?',
        },
        { cmd: args.command, mutation: mutationMatch },
      )
      const approved = await requestUserConfirmation(context, 'command', desc)
      if (!approved) {
        return helpers.error(
          // LLM-facing (rendered into the tool content) — English by design.
          `User denied: "${mutationMatch}" modifies Git state. Use the workspace tool to switch workspaces or branches.`,
        )
      }
    }

    const workingDir = args.cwd ? helpers.resolvePath(args.cwd) : context.workdir

    const pathsToCheck: string[] = [workingDir]

    const commandPaths = extractAbsolutePathsFromCommand(args.command)
    for (const cmdPath of commandPaths) {
      if (isAbsolute(cmdPath)) {
        pathsToCheck.push(cmdPath)
      }
    }

    // Relative `..` traversals resolve against the shell's effective cwd at
    // each token's position (honoring `cd`/`pushd`), not the session workdir
    // — so `cd web && npx vite build --outDir ../dist/web` stays inside the
    // sandbox instead of resolving `..` a level above it.
    pathsToCheck.push(...resolveRelativeTraversals(args.command, workingDir))

    const sensitivePaths = extractSensitivePathsFromCommand(args.command)
    for (const sensitivePath of sensitivePaths) {
      const resolved = isAbsolute(sensitivePath) ? sensitivePath : resolve(workingDir, sensitivePath)
      pathsToCheck.push(resolved)
    }

    await helpers.checkPathAccess(pathsToCheck, args.command)

    const tailInfo = stripTailPipe(args.command)
    const execCommand = tailInfo ? tailInfo.command : args.command

    const execStart = Date.now()
    const result = await executeCommand(execCommand, workingDir, timeout, context.signal, context.onProgress)

    let output = ''

    if (result.stdout) {
      output += result.stdout
    }

    if (result.stderr) {
      if (output) output += '\n\n'
      output += `[stderr]\n${result.stderr}`
    }

    output += `\n\n[Exit code: ${result.exitCode}]`

    if (tailInfo) {
      const lines = output.split('\n')
      const tailed = lines.slice(-tailInfo.tailLines)
      output = tailed.join('\n')
    }

    // Strip ANSI escape sequences before measuring limits so colored output
    // (e.g. from npm test) doesn't consume the byte/line budget invisibly.
    const visible = stripAnsi(output)

    let truncated = false
    if (visible.length > OUTPUT_LIMITS.run_command.maxBytes) {
      output = output.slice(0, OUTPUT_LIMITS.run_command.maxBytes)
      output += '\n\n[Output truncated due to size limit]'
      truncated = true
    }

    const linesCount = visible.split('\n').length
    if (linesCount > OUTPUT_LIMITS.run_command.maxLines) {
      const limitedLines = output.split('\n').slice(0, OUTPUT_LIMITS.run_command.maxLines)
      output = limitedLines.join('\n')
      output += '\n\n[Output truncated due to line limit]'
      truncated = true
    }

    output += `\n[Duration: ${formatDuration(Date.now() - execStart)}]`

    const wasInterrupted = result.interrupted === true

    return helpers.success(output, truncated, {
      success: result.exitCode === 0,
      ...(wasInterrupted ? { metadata: { interrupted: true } } : {}),
      ...(result.exitCode !== 0
        ? {
            // LLM-facing (rendered into the tool content) — English by design.
            error: wasInterrupted ? 'Command was interrupted by user' : `Command exited with code ${result.exitCode}`,
          }
        : {}),
    })
  },
)

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
  interrupted?: boolean
}

function executeCommand(
  command: string,
  cwd: string,
  timeout: number,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (checkAborted(signal)) {
      reject(new Error('Command aborted before execution'))
      return
    }

    const proc = spawnShellProcess(command, cwd, signal, true)
    const stdoutDecoder = createUtf8StreamDecoder()
    const stderrDecoder = createUtf8StreamDecoder()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    let exitCode: number | null = null
    let exited = false
    let settled = false
    let graceTimer: ReturnType<typeof setTimeout> | undefined

    // A detached child (setsid, ssh -f, ...) moves to its own session and
    // process group, so a process-group kill cannot reach it. It then holds
    // the write-ends of the stdio pipes open long after the shell has
    // exited, and Node's 'close' event never fires. To keep the tool call
    // from hanging, wait for 'close' this long after the shell has exited,
    // then settle with the shell's real exit code.
    const ZOMBIE_PIPE_GRACE_MS = 2000

    const settle = (code: number, appendix?: string, interrupted = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      signal?.removeEventListener('abort', onAbort)
      const out = (stdout + stdoutDecoder.end()).trim()
      resolve({
        stdout: appendix ? (out ? `${out}\n\n${appendix}` : appendix) : out,
        stderr: (stderr + stderrDecoder.end()).trim(),
        exitCode: code,
        ...(interrupted ? { interrupted: true } : {}),
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      // The shell already exited and a detached child is holding the pipes:
      // there is nothing left to kill, so settle immediately.
      if (exited) {
        settle(124, `[Exit code: 124]\n[Process timed out after ${timeout}ms]`)
        return
      }
      void terminateProcessTree(proc, { exited: () => exited })
    }, timeout)

    const onAbort = () => {
      if (!timedOut && !aborted) {
        aborted = true
        if (exited) {
          settle(130, '[interrupted by user]', true)
          return
        }
        void terminateProcessTree(proc, { exited: () => exited, immediate: true })
      }
    }
    signal?.addEventListener('abort', onAbort)

    proc.stdout?.on('data', (data: Buffer) => {
      const text = stdoutDecoder.write(data)
      stdout += text
      onProgress?.(`[stdout] ${text}`)
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const text = stderrDecoder.write(data)
      stderr += text
      onProgress?.(`[stderr] ${text}`)
    })

    // The 'exit' event fires when the shell terminates, regardless of
    // whether stdio streams have closed.  'close' only follows once every
    // pipe write-end is closed — which never happens when a detached child
    // outlives the shell.  When we initiated the abort/timeout ourselves we
    // resolve immediately on 'exit'; on a normal exit we wait for 'close'
    // with a bounded grace instead of forever.
    proc.on('exit', (code) => {
      exitCode = code
      exited = true
      if (aborted) {
        settle(130, '[interrupted by user]', true)
        return
      }
      if (timedOut) {
        settle(124, `[Exit code: 124]\n[Process timed out after ${timeout}ms]`)
        return
      }
      graceTimer = setTimeout(() => {
        settle(
          exitCode ?? 1,
          '[Shell exited, but a background process still held the output pipes open, so output may be incomplete]',
        )
      }, ZOMBIE_PIPE_GRACE_MS)
    })

    proc.on('close', (code) => {
      exited = true
      if (graceTimer !== undefined) clearTimeout(graceTimer)

      // Promise may already be settled by 'exit' handler above — settle is a no-op if so.
      if (timedOut) {
        settle(124, `[Exit code: 124]\n[Process timed out after ${timeout}ms]`)
        return
      }

      if (aborted) {
        settle(130, '[interrupted by user]', true)
        return
      }

      settle(code ?? exitCode ?? 1)
    })

    proc.on('error', (error) => {
      clearTimeout(timer)
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}
