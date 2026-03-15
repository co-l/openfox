import fg from 'fast-glob'
import { readFile } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import type { ToolResult } from '@openfox/shared'
import type { Tool, ToolContext } from './types.js'
import { OUTPUT_LIMITS } from './types.js'
import { requestPathAccess } from './path-security.js'

export const grepTool: Tool = {
  name: 'grep',
  definition: {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regex pattern to search for',
          },
          include: {
            type: 'string',
            description: 'File pattern to include (e.g., "*.ts", "*.{js,jsx}")',
          },
          cwd: {
            type: 'string',
            description: 'Base directory for the search (default: session workdir)',
          },
        },
        required: ['pattern'],
      },
    },
  },
  
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now()
    
    try {
      const pattern = args['pattern'] as string
      const include = args['include'] as string | undefined
      const cwd = args['cwd'] as string | undefined
      
      // Resolve working directory
      const baseDir = cwd 
        ? (isAbsolute(cwd) ? cwd : resolve(context.workdir, cwd))
        : context.workdir
      
      // Check sandbox - request confirmation for paths outside workdir
      if (context.onEvent) {
        await requestPathAccess(
          [baseDir],
          context.workdir,
          context.sessionId,
          crypto.randomUUID(),
          'grep',
          context.onEvent
        )
      }
      
      // Create regex
      let regex: RegExp
      try {
        regex = new RegExp(pattern, 'gi')
      } catch {
        return {
          success: false,
          error: `Invalid regex pattern: ${pattern}`,
          durationMs: Date.now() - startTime,
          truncated: false,
        }
      }
      
      // Find files to search
      const globPattern = include ?? '**/*'
      const files = await fg(globPattern, {
        cwd: baseDir,
        onlyFiles: true,
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/.next/**',
          '**/coverage/**',
          '**/*.min.js',
          '**/*.map',
          '**/package-lock.json',
          '**/yarn.lock',
          '**/pnpm-lock.yaml',
        ],
        followSymbolicLinks: false,
        suppressErrors: true,
      })
      
      // Search files
      const matches: { file: string; line: number; content: string }[] = []
      
      for (const file of files) {
        if (matches.length >= OUTPUT_LIMITS.grep.maxMatches) break
        
        try {
          const fullPath = resolve(baseDir, file)
          const content = await readFile(fullPath, 'utf-8')
          const lines = content.split('\n')
          
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= OUTPUT_LIMITS.grep.maxMatches) break
            
            const line = lines[i]!
            if (regex.test(line)) {
              matches.push({
                file,
                line: i + 1,
                content: line.length > 200 ? line.slice(0, 200) + '...' : line,
              })
            }
            
            // Reset regex lastIndex since we're reusing it
            regex.lastIndex = 0
          }
        } catch {
          // Skip files that can't be read (binary files, etc.)
        }
      }
      
      // Format output
      const truncated = matches.length >= OUTPUT_LIMITS.grep.maxMatches
      
      let output = matches
        .map(m => `${m.file}:${m.line}: ${m.content}`)
        .join('\n')
      
      if (output) {
        if (truncated) {
          output += `\n\n[Showing first ${OUTPUT_LIMITS.grep.maxMatches} matches. Refine your search for more specific results.]`
        } else {
          output += `\n\n[${matches.length} match(es) found]`
        }
      } else {
        output = 'No matches found.'
      }
      
      return {
        success: true,
        output,
        durationMs: Date.now() - startTime,
        truncated,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during grep',
        durationMs: Date.now() - startTime,
        truncated: false,
      }
    }
  },
}
