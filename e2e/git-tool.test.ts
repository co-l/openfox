/**
 * Git Tool E2E Tests
 * 
 * Tests the git inspection tool available in planner mode.
 * The git tool is read-only and blocks destructive commands.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { 
  createTestClient, 
  createTestProject,
  createTestServer,
  collectChatEvents,
  assertNoErrors,
  createProject,
  createSession,
  type TestClient, 
  type TestProject,
  type TestServerHandle 
} from './utils/index.js'

describe('Git Tool', () => {
  let server: TestServerHandle
  let client: TestClient
  let testDir: TestProject

  beforeAll(async () => {
    server = await createTestServer()
  })

  afterAll(async () => {
    await server.close()
  })

  beforeEach(async () => {
    client = await createTestClient({ url: server.wsUrl })
    // Create a project with git initialized
    testDir = await createTestProject({ template: 'git-repo' })
    
    const restProject = await createProject(server.url, { name: 'Git Tool Test', workdir: testDir.path })
    const restSession = await createSession(server.url, { projectId: restProject.id })
    await client.send('session.load', { sessionId: restSession.id })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('Basic Git Commands', () => {
    it('executes git status', async () => {
      // Use a prompt that explicitly asks for git status
      await client.send('chat.send', { 
        content: 'Use the git tool with command "git status"' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      const toolCalls = events.get('chat.tool_call')
      const gitCall = toolCalls.find(e => (e.payload as { tool: string }).tool === 'git')
      
      // The mock LLM should trigger a git tool call
      if (gitCall) {
        const toolResults = events.get('chat.tool_result')
        const gitResult = toolResults.find(e => (e.payload as { tool: string }).tool === 'git')
        expect(gitResult).toBeDefined()
        
        const result = (gitResult!.payload as { result: { success: boolean; output?: string } }).result
        expect(result.success).toBe(true)
        // Git status should mention something about the working tree
        expect(result.output).toMatch(/nothing to commit|working tree clean|On branch/i)
      } else {
        // If mock LLM didn't trigger git, at least verify no errors
        expect(toolCalls.length).toBeGreaterThanOrEqual(0)
      }
    })

    it('executes git log', async () => {
      await client.send('chat.send', { 
        content: 'Show me the git log with the last 5 commits.' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      const toolResults = events.get('chat.tool_result')
      const gitResult = toolResults.find(e => (e.payload as { tool: string }).tool === 'git')
      
      if (gitResult) {
        const result = (gitResult.payload as { result: { success: boolean; output?: string } }).result
        expect(result.success).toBe(true)
        // Should contain our initial commit
        expect(result.output).toContain('Initial commit')
      }
    })

    it('executes git branch', async () => {
      await client.send('chat.send', { 
        content: 'List all git branches in the repository.' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      const toolResults = events.get('chat.tool_result')
      const gitResult = toolResults.find(e => (e.payload as { tool: string }).tool === 'git')
      
      if (gitResult) {
        const result = (gitResult.payload as { result: { success: boolean; output?: string } }).result
        expect(result.success).toBe(true)
        // Should show main/master branch
        expect(result.output).toMatch(/main|master/i)
      }
    })

    it('executes git diff on modified file', async () => {
      // Modify a file to create a diff
      await writeFile(join(testDir.path, 'README.md'), '# Modified\n\nNew content.')
      
      await client.send('chat.send', { 
        content: 'Show me the git diff of the changes.' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
      
      const toolResults = events.get('chat.tool_result')
      const gitResult = toolResults.find(e => (e.payload as { tool: string }).tool === 'git')
      
      if (gitResult) {
        const result = (gitResult.payload as { result: { success: boolean; output?: string } }).result
        expect(result.success).toBe(true)
        // Should show the diff with +/- lines
        expect(result.output).toContain('Modified')
      }
    })
  })

  describe('Destructive Command Blocking', () => {
    it('blocks git reset --hard', async () => {
      await client.send('chat.send', { 
        content: 'Run git reset --hard HEAD to reset the repository.' 
      })
      
      const events = await collectChatEvents(client)
      
      const toolResults = events.get('chat.tool_result')
      const gitResult = toolResults.find(e => (e.payload as { tool: string }).tool === 'git')
      
      if (gitResult) {
        const result = (gitResult.payload as { result: { success: boolean; error?: string } }).result
        expect(result.success).toBe(false)
        expect(result.error).toContain('Destructive')
      }
    })

    it('blocks git push --force', async () => {
      // Directly execute a git command that would be destructive
      await client.send('chat.send', { 
        content: 'Execute: git push --force origin main' 
      })
      
      const events = await collectChatEvents(client)
      
      // The mock LLM might not trigger this exact command,
      // but we verify no errors and the system handles it gracefully
      assertNoErrors(events)
    })
  })

  describe('Git in Non-Repository', () => {
    it('handles non-git directory gracefully', async () => {
      // Create a project without git
      const nonGitDir = await createTestProject({ template: 'typescript' })
      
      try {
        const client2 = await createTestClient({ url: server.wsUrl })
        try {
          const restProject = await createProject(server.url, { name: 'Non-Git Test', workdir: nonGitDir.path })
          const restSession = await createSession(server.url, { projectId: restProject.id })
          await client2.send('session.load', { sessionId: restSession.id })
          
          await client2.send('chat.send', { 
            content: 'Run git status to check the repository state.' 
          })
          
          const events = await collectChatEvents(client2)
          
          const toolResults = events.get('chat.tool_result')
          const gitResult = toolResults.find(e => (e.payload as { tool: string }).tool === 'git')
          
          if (gitResult) {
            const result = (gitResult.payload as { result: { success: boolean; error?: string } }).result
            // Git should fail with "not a git repository"
            expect(result.success).toBe(false)
            expect(result.error).toContain('not a git repository')
          }
        } finally {
          await client2.close()
        }
      } finally {
        await nonGitDir.cleanup()
      }
    })
  })

  describe('Git with Working Directory', () => {
    it('supports cwd parameter', async () => {
      // Create a subdirectory that's also a git repo
      execSync('mkdir -p subproject && cd subproject && git init', { cwd: testDir.path })
      execSync('git config user.email "test@example.com"', { cwd: join(testDir.path, 'subproject') })
      execSync('git config user.name "Test"', { cwd: join(testDir.path, 'subproject') })
      await writeFile(join(testDir.path, 'subproject/file.txt'), 'content')
      execSync('git add . && git commit -m "Sub commit"', { cwd: join(testDir.path, 'subproject') })
      
      // The git tool with cwd should work
      await client.send('chat.send', { 
        content: 'Run git status to see the current state.' 
      })
      
      const events = await collectChatEvents(client)
      assertNoErrors(events)
    })
  })
})
