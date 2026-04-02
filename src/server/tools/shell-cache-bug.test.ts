import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runCommandTool } from './shell.js'
import type { ToolContext } from './types.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('shell tool cache preservation bug', () => {
  let tempDir: string
  let context: ToolContext
  
  const mockSessionManager = {
    recordFileRead: vi.fn(),
    getReadFiles: vi.fn().mockReturnValue({}),
    updateFileHash: vi.fn(),
  } as any

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shell-cache-test-'))
    context = {
      sessionManager: mockSessionManager,
      workdir: tempDir,
      sessionId: 'test-session',
    }
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should return consistent output for the same failing command across multiple calls', async () => {
    // This test reproduces the cache-preservation bug where a failing command
    // returns different output on subsequent calls, breaking LLM KV cache.
    // 
    // The bug: When a command fails (exit code != 0), subsequent calls
    // should return the SAME stdout/stderr as the first call.
    
    const command = 'echo "error output" && exit 1'
    
    // First call
    const result1 = await runCommandTool.execute(
      { command },
      context
    )
    
    console.log('Result 1 output:', result1.output)
    console.log('Result 1 error:', result1.error)
    
    // Second call (same command, should produce identical output)
    const result2 = await runCommandTool.execute(
      { command },
      context
    )
    
    console.log('Result 2 output:', result2.output)
    console.log('Result 2 error:', result2.error)
    
    // Both should have the same output
    expect(result1.output).toEqual(result2.output)
    
    // Both should contain the error output
    expect(result1.output).toContain('error output')
    expect(result2.output).toContain('error output')
    
    // Both should fail
    expect(result1.success).toBe(false)
    expect(result2.success).toBe(false)
  })

  it('should include stderr in output for failing commands', async () => {
    const command = 'echo "stdout line" && echo "stderr error" >&2 && exit 1'
    
    const result = await runCommandTool.execute(
      { command },
      context
    )
    
    // Should contain both stdout and stderr
    expect(result.output).toContain('stdout line')
    expect(result.output).toContain('stderr error')
    
    // Should indicate failure
    expect(result.success).toBe(false)
  })

  it('should return full output even when command fails', async () => {
    // Create a script that outputs multiple lines then fails
    const scriptPath = join(tempDir, 'fail-script.sh')
    await writeFile(scriptPath, `#!/bin/bash
echo "line 1"
echo "line 2" 
echo "line 3"
echo "This is stderr" >&2
exit 1
`)
    
    const result = await runCommandTool.execute(
      { command: `bash ${scriptPath}` },
      context
    )
    
    // Should contain ALL output, not just an error message
    expect(result.output).toContain('line 1')
    expect(result.output).toContain('line 2')
    expect(result.output).toContain('line 3')
    expect(result.output).toContain('This is stderr')
    expect(result.success).toBe(false)
  })
})
