import { spawn } from 'node:child_process'
import { resolve, isAbsolute } from 'node:path'
import { access } from 'node:fs/promises'
import stripAnsi from 'strip-ansi'
import { OUTPUT_LIMITS } from './types.js'
import { createTool } from './tool-helpers.js'
import { checkAborted, spawnShellProcess } from '../utils/shell.js'
import { extractAbsolutePathsFromCommand, extractSensitivePathsFromCommand } from './path-security.js'
import { terminateProcessTree } from '../utils/process-tree.js'
import { stripTailPipe } from './shell-tail.js'
import { getSetting, SETTINGS_KEYS } from '../db/settings.js'

let rtkAvailable: boolean | undefined

async function checkRtkAvailability(): Promise<boolean> {
  if (rtkAvailable !== undefined) return rtkAvailable
  try {
    await access('/usr/local/bin/rtk')
    rtkAvailable = true
  } catch {
    try {
      const out = await new Promise<string>((resolve, reject) => {
        const proc = spawn('rtk', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''
        proc.stdout?.on('data', (d: Buffer) => {
          output += d.toString()
        })
        proc.on('error', reject)
        proc.on('close', (code) => {
          if (code === 0) resolve(output.trim())
          else reject(new Error(`exit ${code}`))
        })
      })
      rtkAvailable = out.startsWith('rtk ')
    } catch {
      rtkAvailable = false
    }
  }
  return rtkAvailable
}

export function hasBackgroundAmpersand(command: string): boolean {
  const trimmed = command.replace(/[;\s]+$/, '')
  if (trimmed.endsWith('&')) {
    const before = trimmed[trimmed.length - 2]
    if (before === '&' || before === '|') return false
    return true
  }
  return false
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
        'Execute a shell command. Returns stdout, stderr, and exit code. Does NOT support trailing "&" for backgrounding — use background_process tool instead.',
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
        'Use background_process tool (action: "start") for background/long-running commands instead of \'&\'. See the tool description for details.',
      )
    }

    const workingDir = args.cwd ? helpers.resolvePath(args.cwd) : context.workdir

    const pathsToCheck: string[] = [workingDir]

    const commandPaths = extractAbsolutePathsFromCommand(args.command)
    for (const cmdPath of commandPaths) {
      const resolved = isAbsolute(cmdPath) ? cmdPath : resolve(workingDir, cmdPath)
      pathsToCheck.push(resolved)
    }

    const sensitivePaths = extractSensitivePathsFromCommand(args.command)
    for (const sensitivePath of sensitivePaths) {
      const resolved = isAbsolute(sensitivePath) ? sensitivePath : resolve(workingDir, sensitivePath)
      pathsToCheck.push(resolved)
    }

    await helpers.checkPathAccess(pathsToCheck, args.command)

    const tailInfo = stripTailPipe(args.command)
    const execCommand = tailInfo ? tailInfo.command : args.command

    const useRtk = getSetting(SETTINGS_KEYS.TOOLS_USE_RTK) === 'true'
    const finalCommand = useRtk ? await tryRtkRewrite(execCommand) : execCommand

    const result = await executeCommand(finalCommand, workingDir, timeout, context.signal, context.onProgress)

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

    const wasInterrupted = output.includes('[interrupted by user]')

    return helpers.success(output, truncated, {
      success: result.exitCode === 0,
      ...(result.exitCode !== 0 && !wasInterrupted ? { error: `Command exited with code ${result.exitCode}` } : {}),
    })
  },
)

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

async function tryRtkRewrite(command: string): Promise<string> {
  if (!(await checkRtkAvailability())) return command
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const proc = spawn('rtk', ['rewrite', command], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 2_000,
      })
      let stdout = ''
      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })
      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code === 0 || code === 3) resolve(stdout.trim())
        else reject(new Error(`exit ${code}`))
      })
    })
    if (result && result !== command) return result
  } catch {
    // rewrite failed — fall through
  }
  return command
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
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    let exited = false

    const timer = setTimeout(() => {
      timedOut = true
      void terminateProcessTree(proc, { exited: () => exited })
    }, timeout)

    const onAbort = () => {
      if (!timedOut && !aborted) {
        aborted = true
        void terminateProcessTree(proc, { exited: () => exited, immediate: true })
      }
    }
    signal?.addEventListener('abort', onAbort)

    proc.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stdout += chunk
      onProgress?.(`[stdout] ${chunk}`)
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr += chunk
      onProgress?.(`[stderr] ${chunk}`)
    })

    proc.on('close', (code) => {
      exited = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)

      if (timedOut) {
        let output = stdout.trim()
        if (output) output += '\n\n'
        output += `[Exit code: 124]\n[Process timed out after ${timeout}ms]`
        resolve({
          stdout: output,
          stderr: stderr.trim(),
          exitCode: 124,
        })
        return
      }

      if (aborted) {
        let output = stdout.trim()
        if (output) output += '\n\n'
        output += '[interrupted by user]'
        resolve({
          stdout: output,
          stderr: stderr.trim(),
          exitCode: 130,
        })
        return
      }

      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
      })
    })

    proc.on('error', (error) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}
