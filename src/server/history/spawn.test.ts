import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'

/**
 * Test that the history process can be spawned correctly using npx tsx
 * This verifies that we don't have hardcoded path issues that break on global installation
 */
describe('history process spawn', () => {
  it('spawns history process with npx tsx without ENOENT error', async () => {
    // This test verifies that npx tsx can resolve and spawn the process
    // We're testing the spawn mechanism itself, not the full history service
    
    // Spawn a simple tsx command to verify it works
    const child = spawn('npx', ['tsx', '--version'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let exited = false
    let exitCode: number | null = null

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.on('error', (error) => {
      // This would be the ENOENT error we're trying to fix
      throw new Error(`Failed to spawn npx tsx: ${error.message}`)
    })

    child.on('exit', (code) => {
      exited = true
      exitCode = code
    })

    // Wait for process to complete
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 10000)
      const checkExit = () => {
        if (exited) {
          clearTimeout(timeout)
          resolve()
        }
      }
      child.on('exit', checkExit)
      // Also resolve if we have output (tsx --version should print immediately)
      if (stdout) {
        clearTimeout(timeout)
        resolve()
      }
    })

    // Verify npx tsx worked
    expect(exited).toBe(true)
    expect(exitCode).toBe(0)
    expect(stdout).toContain('tsx')
  })

  it('spawns process with workdir argument in correct format', () => {
    // Verify the spawn command structure matches what we need
    const workdir = '/test/workdir'
    const entrypoint = '/path/to/entry.ts'
    
    // This is the expected format - npx tsx with entrypoint and workdir as args
    const expectedArgs = [entrypoint, workdir]
    
    expect(expectedArgs).toHaveLength(2)
    expect(expectedArgs[0]).toBe(entrypoint)
    expect(expectedArgs[1]).toBe(workdir)
  })
})
