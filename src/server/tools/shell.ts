import { resolve, isAbsolute } from 'node:path'
import { OUTPUT_LIMITS } from './types.js'
import { createTool } from './tool-helpers.js'
import { checkAborted, spawnShellProcess } from '../utils/shell.js'
import { extractAbsolutePathsFromCommand, extractSensitivePathsFromCommand } from './path-security.js'
import { terminateProcessTree } from '../utils/process-tree.js'

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
      description: 'Execute a shell command. Returns stdout, stderr, and exit code.',
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
            description: 'Timeout in milliseconds (default: 120000, max: 300000)',
          },
        },
        required: ['command'],
      },
    },
  },
  async (args, context, helpers) => {
    const timeout = Math.min(args.timeout ?? 120_000, 300_000)

    // Resolve working directory
    const workingDir = args.cwd ? helpers.resolvePath(args.cwd) : context.workdir

    // Collect all paths that need checking
    const pathsToCheck: string[] = [workingDir]

    // Extract absolute paths from command (including ~ expansion)
    const commandPaths = extractAbsolutePathsFromCommand(args.command)
    for (const cmdPath of commandPaths) {
      const resolved = isAbsolute(cmdPath) ? cmdPath : resolve(workingDir, cmdPath)
      pathsToCheck.push(resolved)
    }

    // Extract sensitive file paths from command (like .env, credentials.json)
    const sensitivePaths = extractSensitivePathsFromCommand(args.command)
    for (const sensitivePath of sensitivePaths) {
      const resolved = isAbsolute(sensitivePath) ? sensitivePath : resolve(workingDir, sensitivePath)
      pathsToCheck.push(resolved)
    }

    // Check all paths - request confirmation for paths outside workdir or sensitive files
    // Also checks for dangerous commands
    await helpers.checkPathAccess(pathsToCheck, args.command)

    // Execute command
    const result = await executeCommand(args.command, workingDir, timeout, context.signal, context.onProgress)

    // Format output
    let output = ''

    if (result.stdout) {
      output += result.stdout
    }

    if (result.stderr) {
      if (output) output += '\n\n'
      output += `[stderr]\n${result.stderr}`
    }

    output += `\n\n[Exit code: ${result.exitCode}]`

    // Check truncation
    let truncated = false
    if (output.length > OUTPUT_LIMITS.run_command.maxBytes) {
      output = output.slice(0, OUTPUT_LIMITS.run_command.maxBytes)
      output += '\n\n[Output truncated due to size limit]'
      truncated = true
    }

    const lines = output.split('\n').length
    if (lines > OUTPUT_LIMITS.run_command.maxLines) {
      const limitedLines = output.split('\n').slice(0, OUTPUT_LIMITS.run_command.maxLines)
      output = limitedLines.join('\n')
      output += '\n\n[Output truncated due to line limit]'
      truncated = true
    }

    // Check if this was an interrupted command (marker in output, exit code 130)
    const wasInterrupted = output.includes('[interrupted by user]')

    return helpers.success(output, truncated, {
      // Mark as not successful if non-zero exit (unless interrupted)
      success: result.exitCode === 0,
      // Don't set error for interrupted commands - the marker is sufficient
      ...(result.exitCode !== 0 && !wasInterrupted ? { error: `Command exited with code ${result.exitCode}` } : {}),
    })
  },
)

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

function executeCommand(
  command: string,
  cwd: string,
  timeout: number,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    // Check if already aborted before starting
    if (checkAborted(signal)) {
      reject(new Error('Command aborted before execution'))
      return
    }

    const proc = spawnShellProcess(command, cwd, signal, true)
    let stdout = ''
    let stderr = ''
    let killed = false
    let aborted = false
    let exited = false

    const timer = setTimeout(() => {
      killed = true
      void terminateProcessTree(proc, { exited: () => exited })
      reject(new Error(`Command timed out after ${timeout}ms`))
    }, timeout)

    // Handle abort signal - kill entire process group (like Ctrl+C)
    const onAbort = () => {
      if (!killed && !aborted) {
        aborted = true
        void terminateProcessTree(proc, { exited: () => exited })
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

      if (killed) {
        // Already rejected by timeout
        return
      }

      if (aborted) {
        // Return partial output with interrupted marker (not an error)
        let output = stdout.trim()
        if (output) output += '\n\n'
        output += '[interrupted by user]'
        resolve({
          stdout: output,
          stderr: stderr.trim(),
          exitCode: 130, // Standard SIGINT exit code
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
