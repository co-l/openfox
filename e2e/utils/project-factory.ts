/**
 * Test project factory for E2E tests.
 * 
 * Creates temporary directories with sample project structures.
 */

import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ============================================================================
// Types
// ============================================================================

export interface TestProjectOptions {
  /** Project template to use */
  template?: 'empty' | 'typescript' | 'simple-js' | 'with-agents-md'
  /** Custom files to add (path → content) */
  files?: Record<string, string>
  /** Custom AGENTS.md content */
  agentsMd?: string
}

export interface TestProject {
  /** Absolute path to project directory */
  path: string
  /** Clean up the project directory */
  cleanup(): Promise<void>
}

// ============================================================================
// Templates
// ============================================================================

const TEMPLATES = {
  empty: {},
  
  typescript: {
    'package.json': JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      type: 'module',
      scripts: {
        build: 'tsc',
        test: 'echo "No tests"',
      },
      devDependencies: {
        typescript: '^5.0.0',
      },
    }, null, 2),
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        outDir: 'dist',
      },
      include: ['src/**/*'],
    }, null, 2),
    'src/index.ts': `// Main entry point
export function hello(name: string): string {
  return \`Hello, \${name}!\`
}
`,
    'src/math.ts': `// Math utilities
export function add(a: number, b: number): number {
  return a + b
}

export function subtract(a: number, b: number): number {
  return a - b
}
`,
  },
  
  'simple-js': {
    'package.json': JSON.stringify({
      name: 'simple-project',
      version: '1.0.0',
      type: 'module',
    }, null, 2),
    'index.js': `// Simple JS project
console.log('Hello, world!')
`,
  },
  
  'with-agents-md': {
    'package.json': JSON.stringify({
      name: 'agents-project',
      version: '1.0.0',
      type: 'module',
    }, null, 2),
    'AGENTS.md': `# Project Guidelines

## Code Style
- Use functional programming patterns
- Prefer composition over inheritance
- Always write tests first (TDD)

## Testing
Run tests with: npm test
`,
    'src/index.js': `// Project with AGENTS.md
export function greet(name) {
  return \`Hello, \${name}!\`
}
`,
  },
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a temporary test project.
 * 
 * @example
 * const project = await createTestProject({ template: 'typescript' })
 * try {
 *   // Use project.path in tests
 * } finally {
 *   await project.cleanup()
 * }
 */
export async function createTestProject(options: TestProjectOptions = {}): Promise<TestProject> {
  const { template = 'empty', files = {}, agentsMd } = options
  
  // Create unique temp directory
  const projectPath = join(tmpdir(), `openfox-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  await mkdir(projectPath, { recursive: true })
  
  // Get template files
  const templateFiles = TEMPLATES[template]
  
  // Merge template + custom files
  const allFiles: Record<string, string> = { ...templateFiles, ...files }
  
  // Add AGENTS.md if specified
  if (agentsMd) {
    allFiles['AGENTS.md'] = agentsMd
  }
  
  // Write all files
  for (const [filePath, content] of Object.entries(allFiles)) {
    const fullPath = join(projectPath, filePath)
    const dir = join(fullPath, '..')
    await mkdir(dir, { recursive: true })
    await writeFile(fullPath, content)
  }
  
  return {
    path: projectPath,
    async cleanup() {
      await rm(projectPath, { recursive: true, force: true })
    },
  }
}

/**
 * Create multiple test projects.
 * Useful for testing project listing, etc.
 */
export async function createTestProjects(
  count: number,
  options?: TestProjectOptions
): Promise<TestProject[]> {
  return Promise.all(
    Array.from({ length: count }, () => createTestProject(options))
  )
}

/**
 * Cleanup multiple test projects.
 */
export async function cleanupProjects(projects: TestProject[]): Promise<void> {
  await Promise.all(projects.map(p => p.cleanup()))
}
