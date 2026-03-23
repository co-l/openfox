import { spawn } from 'node:child_process'
import { resolve, isAbsolute } from 'node:path'
import type { ToolResult } from '../../shared/types.js'
import type { Tool, ToolContext } from './types.js'
import { OUTPUT_LIMITS } from './types.js'
import { terminateProcessTree } from '../utils/process-tree.js'

export const gitTool: Tool = {
  name: 'git',
  definition: {
    type: 'function',
    function: {
      name: 'git',
      description: 'Execute a git command to inspect repository state. Use for checking status, diffs, logs, branches, etc. Cannot modify the repository.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The git command to execute (e.g., "git status", "git diff", "git log --oneline -5")',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the command (default: session workdir). Must be within a git repository.',
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
      
      // Validate command starts with git
      if (!command || typeof command !== 'string') {
        return {
          success: false,
          error: 'command is required',
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      if (!command.startsWith('git')) {
        return {
          success: false,
          error: `Command must start with "git". Received: ${command}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      // Block destructive git commands
      const destructivePatterns = [
        /git\s+(reset\s+--hard|reset\s+--hard\s+HEAD)/,
        /git\s+(clean\s+-[a-z]*f[a-z]*|-f.*clean)/,
        /git\s+push\s+--force/,
        /git\s+branch\s+-D/,
        /git\s+update-ref\s+-d/,
      ]
      
      for (const pattern of destructivePatterns) {
        if (pattern.test(command)) {
          return {
            success: false,
            error: `Destructive git command blocked: ${command}\n\nThe git tool is read-only. Use builder mode for repository modifications.`,
            durationMs: Date.now() - startTime,
            truncated: false,
          }
        }
      }
      
      // Resolve working directory
      const workingDir = cwd 
        ? (isAbsolute(cwd) ? cwd : resolve(context.workdir, cwd))
        : context.workdir
      
      // Execute git command
      const result = await executeGitCommand(command, workingDir, context.signal)
      
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
        ...(result.exitCode !== 0 ? { error: `Git command exited with code ${result.exitCode}` } : {}),
        durationMs: Date.now() - startTime,
        truncated,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error executing git command',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }
  },
}

interface GitResult {
  stdout: string
  stderr: string
  exitCode: number
}

function executeGitCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Git command aborted before execution'))
      return
    }
    
    const proc = spawn('sh', ['-c', command], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    
    let stdout = ''
    let stderr = ''
    let aborted = false
    let exited = false

    const onAbort = () => {
      if (!aborted) {
        aborted = true
        void terminateProcessTree(proc, { exited: () => exited })
      }
    }
    signal?.addEventListener('abort', onAbort)
    
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    
    proc.on('close', (code) => {
      exited = true
      signal?.removeEventListener('abort', onAbort)
      
      if (aborted) {
        resolve({
          stdout: stdout.trim() + '\n[interrupted by user]',
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
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}
