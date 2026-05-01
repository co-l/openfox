import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runCommandTool } from './shell.js'
import type { ToolContext } from './types.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('shell tool streaming', () => {
  let tempDir: string
  let context: ToolContext
  
  // Mock sessionManager for test context
  const mockSessionManager = {
    recordFileRead: vi.fn(),
    getReadFiles: vi.fn().mockReturnValue({}),
    updateFileHash: vi.fn(),
  } as any

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'shell-test-'))
    context = {
      sessionManager: mockSessionManager,
      workdir: tempDir,
      sessionId: 'test-session',
    }
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('calls onProgress for each stdout chunk', async () => {
    const onProgress = vi.fn()
    context.onProgress = onProgress

    await runCommandTool.execute(
      { command: 'echo "line1" && echo "line2"' },
      context
    )

    // Should have called onProgress at least once for stdout
    expect(onProgress).toHaveBeenCalled()
    
    // All calls should have [stdout] prefix
    const stdoutCalls = onProgress.mock.calls.filter(
      (call) => (call[0] as string).startsWith('[stdout]')
    )
    expect(stdoutCalls.length).toBeGreaterThan(0)
    
    // Combined output should contain both lines
    const allOutput = stdoutCalls.map(c => c[0]).join('')
    expect(allOutput).toContain('line1')
    expect(allOutput).toContain('line2')
  })

  it('calls onProgress for stderr chunks', async () => {
    const onProgress = vi.fn()
    context.onProgress = onProgress

    await runCommandTool.execute(
      { command: 'echo "error message" >&2' },
      context
    )

    // Should have called onProgress with stderr prefix
    const stderrCalls = onProgress.mock.calls.filter(
      (call) => (call[0] as string).startsWith('[stderr]')
    )
    expect(stderrCalls.length).toBeGreaterThan(0)
    
    const allOutput = stderrCalls.map(c => c[0]).join('')
    expect(allOutput).toContain('error message')
  })

  it('distinguishes stdout and stderr in separate calls', async () => {
    const onProgress = vi.fn()
    context.onProgress = onProgress

    await runCommandTool.execute(
      { command: 'echo "out" && echo "err" >&2' },
      context
    )

    const stdoutCalls = onProgress.mock.calls.filter(
      (call) => (call[0] as string).startsWith('[stdout]')
    )
    const stderrCalls = onProgress.mock.calls.filter(
      (call) => (call[0] as string).startsWith('[stderr]')
    )

    expect(stdoutCalls.length).toBeGreaterThan(0)
    expect(stderrCalls.length).toBeGreaterThan(0)
    
    expect(stdoutCalls.map(c => c[0]).join('')).toContain('out')
    expect(stderrCalls.map(c => c[0]).join('')).toContain('err')
  })

  it('streams output before completion for slow commands', async () => {
    const progressTimes: number[] = []
    const onProgress = vi.fn(() => {
      progressTimes.push(Date.now())
    })
    context.onProgress = onProgress

    const startTime = Date.now()
    
    // Command that outputs, waits, then outputs again
    await runCommandTool.execute(
      { command: 'echo "first" && sleep 0.1 && echo "second"', timeout: 5000 },
      context
    )
    
    
    
    // Should have received progress before command completed
    expect(onProgress).toHaveBeenCalled()
    
    // The first progress call should have happened before the sleep completed
    // (total time > 100ms due to sleep, first call should be < 100ms from start)
    if (progressTimes.length > 0) {
      const firstProgressTime = progressTimes[0]! - startTime
      expect(firstProgressTime).toBeLessThan(100) // First output before sleep
    }
  })

  it('preserves newlines in output chunks', async () => {
    const onProgress = vi.fn()
    context.onProgress = onProgress

    // Create a script that outputs multiple lines
    const scriptPath = join(tempDir, 'multiline.sh')
    await writeFile(scriptPath, `#!/bin/bash
echo "line 1"
echo "line 2"
echo "line 3"
`)
    
    await runCommandTool.execute(
      { command: `bash ${scriptPath}` },
      context
    )

    // Get all stdout output
    const allOutput = onProgress.mock.calls
      .filter((call) => (call[0] as string).startsWith('[stdout]'))
      .map(c => (c[0] as string).replace('[stdout] ', ''))
      .join('')
    
    // Should contain all lines (may be in one chunk or multiple)
    expect(allOutput).toContain('line 1')
    expect(allOutput).toContain('line 2')
    expect(allOutput).toContain('line 3')
  })

  it('does not call onProgress when not provided', async () => {
    // Context without onProgress
    const plainContext: ToolContext = {
      sessionManager: mockSessionManager,
      workdir: tempDir,
      sessionId: 'test-session',
    }

    // Should not throw
    const result = await runCommandTool.execute(
      { command: 'echo "test"' },
      plainContext
    )

    expect(result.success).toBe(true)
    expect(result.output).toContain('test')
  })

  it('returns partial output with interrupted marker when aborted', async () => {
    const controller = new AbortController()
    const contextWithSignal: ToolContext = {
      sessionManager: mockSessionManager,
      workdir: tempDir,
      sessionId: 'test-session',
      signal: controller.signal,
    }

    // Start command: echo immediately, then sleep
    const resultPromise = runCommandTool.execute(
      { command: 'echo "partial output"; sleep 4; echo "never reached"' },
      contextWithSignal
    )

    // Wait for echo to complete, then abort
    await new Promise(r => setTimeout(r, 500))
    controller.abort()

    const result = await resultPromise

    // Should have partial output with interrupted marker
    expect(result.output).toContain('partial output')
    expect(result.output).toContain('[interrupted by user]')
    // Should NOT have the post-sleep output
    expect(result.output).not.toContain('never reached')
    // Exit code 130 = SIGINT, so success is false
    expect(result.success).toBe(false)
    // No error field - this is a controlled interruption, not an error
    expect(result.error).toBeUndefined()
  }, 10000)

  it('aborts promptly even when the process ignores SIGINT', async () => {
    const controller = new AbortController()
    const contextWithSignal: ToolContext = {
      sessionManager: mockSessionManager,
      workdir: tempDir,
      sessionId: 'test-session',
      signal: controller.signal,
    }

    const started = Date.now()
    const resultPromise = runCommandTool.execute(
      {
        command: `${process.execPath} -e "process.on('SIGINT', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"`,
      },
      contextWithSignal,
    )

    await new Promise(r => setTimeout(r, 300))
    controller.abort()

    const result = await resultPromise

    expect(Date.now() - started).toBeLessThan(2500)
    expect(result.output).toContain('ready')
    expect(result.output).toContain('[interrupted by user]')
  }, 10000)
})

// Separate import for afterEach
import { afterEach } from 'vitest'
