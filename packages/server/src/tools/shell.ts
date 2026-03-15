import { spawn } from 'node:child_process'
import { resolve, isAbsolute } from 'node:path'
import type { ToolResult } from '@openfox/shared'
import type { Tool, ToolContext } from './types.js'
import { OUTPUT_LIMITS } from './types.js'
import {
  extractAbsolutePathsFromCommand,
  requestPathAccess,
} from './path-security.js'

const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s+[\/~]/,
  /sudo\s/,
  /chmod\s+777/,
  />\s*\/dev\/sd/,
  /mkfs\s/,
  /dd\s+if=/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,  // Fork bomb
]

export const runCommandTool: Tool = {
  name: 'run_command',
  definition: {
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
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const command = args['command'] as string
      const cwd = args['cwd'] as string | undefined
      const timeout = Math.min(
        (args['timeout'] as number | undefined) ?? 120_000,
        300_000
      )
      
      // Check for dangerous commands
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) {
          return {
            success: false,
            error: `Command appears dangerous and was blocked: ${command}\n\nIf you really need to run this, ask the user for confirmation.`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
      }
      
      // Resolve working directory
      const workingDir = cwd 
        ? (isAbsolute(cwd) ? cwd : resolve(context.workdir, cwd))
        : context.workdir
      
      // Check sandbox - collect all paths that need checking
      const pathsToCheck: string[] = [workingDir]
      
      // Extract absolute paths from command (including ~ expansion)
      const commandPaths = extractAbsolutePathsFromCommand(command)
      for (const cmdPath of commandPaths) {
        // Resolve relative to the working directory
        const resolved = isAbsolute(cmdPath) ? cmdPath : resolve(workingDir, cmdPath)
        pathsToCheck.push(resolved)
      }
      
      // Check all paths - request confirmation for paths outside workdir
      if (context.onEvent) {
        await requestPathAccess(
          pathsToCheck,
          context.workdir,
          context.sessionId,
          crypto.randomUUID(),
          'run_command',
          context.onEvent
        )
      }
      
      // Execute command
      const result = await executeCommand(command, workingDir, timeout, context.onProgress)
      
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
      
      return {
        success: result.exitCode === 0,
        output,
        ...(result.exitCode !== 0 ? { error: `Command exited with code ${result.exitCode}` } : {}),
        durationMs: Date.now() - startTime,
        truncated,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error executing command',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }
  },
}

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

function executeCommand(
  command: string,
  cwd: string,
  timeout: number,
  onProgress?: (message: string) => void
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('sh', ['-c', command], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    
    let stdout = ''
    let stderr = ''
    let killed = false
    
    const timer = setTimeout(() => {
      killed = true
      proc.kill('SIGKILL')
      reject(new Error(`Command timed out after ${timeout}ms`))
    }, timeout)
    
    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stdout += chunk
      onProgress?.(`[stdout] ${chunk.trim()}`)
    })
    
    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr += chunk
      onProgress?.(`[stderr] ${chunk.trim()}`)
    })
    
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (!killed) {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? 1,
        })
      }
    })
    
    proc.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}
