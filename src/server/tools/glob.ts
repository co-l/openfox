import fg from 'fast-glob'
import { OUTPUT_LIMITS } from './types.js'
import { createTool } from './tool-helpers.js'

interface GlobArgs {
  pattern: string
  cwd?: string
}

export const globTool = createTool<GlobArgs>(
  'glob',
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files matching a glob pattern. Returns list of matching file paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.{js,jsx}")',
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
    
    // Execute glob
    const files = await fg(args.pattern, {
      cwd: baseDir,
      onlyFiles: true,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/coverage/**',
      ],
      followSymbolicLinks: false,
      suppressErrors: true,
    })
    
    // Sort alphabetically
    files.sort()
    
    // Apply limit
    const truncated = files.length > OUTPUT_LIMITS.glob.maxResults
    const limitedFiles = files.slice(0, OUTPUT_LIMITS.glob.maxResults)
    
    // Format output
    let output = limitedFiles.join('\n')
    
    if (truncated) {
      output += `\n\n[Showing first ${OUTPUT_LIMITS.glob.maxResults} of ${files.length} matches]`
    } else {
      output += `\n\n[${files.length} file(s) found]`
    }
    
    return helpers.success(output, truncated)
  }
)
