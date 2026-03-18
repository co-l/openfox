import fg from 'fast-glob'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { OUTPUT_LIMITS } from './types.js'
import { createTool } from './tool-helpers.js'

interface GrepArgs {
  pattern: string
  include?: string
  cwd?: string
}

export const grepTool = createTool<GrepArgs>(
  'grep',
  {
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
  async (args, context, helpers) => {
    // Resolve working directory
    const baseDir = args.cwd 
      ? helpers.resolvePath(args.cwd)
      : context.workdir
    
    await helpers.checkPathAccess([baseDir])
    
    // Create regex
    let regex: RegExp
    try {
      regex = new RegExp(args.pattern, 'gi')
    } catch {
      return helpers.error(`Invalid regex pattern: ${args.pattern}`)
    }
    
    // Find files to search
    const globPattern = args.include ?? '**/*'
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
    
    return helpers.success(output, truncated)
  }
)
