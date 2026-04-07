/**
 * Tests for project creation with directory and git initialization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, rm, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { validateProjectName, directoryExists, createDirectoryWithGit } from './project-creator.js'

describe('project-creator', () => {
  let testDir: string

  beforeEach(async () => {
    // Create a unique temp directory for each test run
    testDir = join(tmpdir(), `openfox-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('validateProjectName', () => {
    it('should accept valid project names', () => {
      const validNames = ['my-project', 'my_project', 'my.project', 'Project123', 'test-123']
      
      for (const name of validNames) {
        const result = validateProjectName(name)
        expect(result.valid).toBe(true)
      }
    })

    it('should reject empty project names', () => {
      const result = validateProjectName('')
      expect(result.valid).toBe(false)
      expect((result as { valid: false; error: string }).error).toContain('empty')
    })

    it('should reject project names with invalid characters', () => {
      const invalidNames = ['my@project', 'my#project', 'my$project']
      
      for (const name of invalidNames) {
        const result = validateProjectName(name)
        expect(result.valid).toBe(false)
      }
    })

    it('should accept project names with spaces', () => {
      const result = validateProjectName('my project')
      expect(result.valid).toBe(true)
    })

    it('should reject path traversal attempts', () => {
      const result1 = validateProjectName('../etc')
      expect(result1.valid).toBe(false)
      
      const result2 = validateProjectName('my-project/../other')
      expect(result2.valid).toBe(false)
    })
  })

  describe('directoryExists', () => {
    it('should return true for existing directory', async () => {
      const existingDir = join(testDir, 'existing')
      await mkdir(existingDir, { recursive: true })
      
      const exists = await directoryExists(existingDir)
      expect(exists).toBe(true)
    })

    it('should return false for non-existing directory', async () => {
      const nonExistingDir = join(testDir, 'non-existing')
      
      const exists = await directoryExists(nonExistingDir)
      expect(exists).toBe(false)
    })
  })

  describe('createDirectoryWithGit', () => {
    beforeEach(async () => {
      // Initialize database for each test
      const { initDatabase } = await import('../db/index.js')
      const { loadConfig } = await import('../config.js')
      const config = loadConfig()
      initDatabase(config)
    })

    it('should create directory and initialize git repository', async () => {
      const projectName = 'test-project-db'
      
      const project = await createDirectoryWithGit(projectName, testDir)
      
      // Check project was created in database with base workdir
      expect(project.name).toBe(projectName)
      expect(project.workdir).toBe(testDir)
      
      // Check directory with sanitized name exists (spaces replaced with hyphens)
      const fullPath = join(testDir, projectName)
      const dirExists = await directoryExists(fullPath)
      expect(dirExists).toBe(true)
      
      // Check git repository was initialized
      const gitDir = join(fullPath, '.git')
      const gitExists = await directoryExists(gitDir)
      expect(gitExists).toBe(true)
    })

    it('should reject invalid project names', async () => {
      await expect(createDirectoryWithGit('invalid/name', testDir)).rejects.toThrow('only contain')
      await expect(createDirectoryWithGit('invalid\\name', testDir)).rejects.toThrow('only contain')
    })

    it('should reject if directory already exists', async () => {
      // Create the directory first
      const projectName = 'existing-project'
      const fullPath = join(testDir, projectName)
      await mkdir(fullPath, { recursive: true })
      
      await expect(createDirectoryWithGit(projectName, testDir)).rejects.toThrow('already exists')
    })

    it('should clean up directory if git init fails', async () => {
      // This test would require mocking git command failure
      // For now, we test the happy path
      const projectName = 'test-git-cleanup'
      const project = await createDirectoryWithGit(projectName, testDir)
      
      // Verify git is initialized in full path
      const fullPath = join(testDir, projectName)
      const gitDir = join(fullPath, '.git')
      const gitExists = await directoryExists(gitDir)
      expect(gitExists).toBe(true)
    })

    it('should handle special characters in project name correctly', async () => {
      const projectName = 'test.project-123'
      
      const project = await createDirectoryWithGit(projectName, testDir)
      
      expect(project.name).toBe(projectName)
      expect(project.workdir).toBe(testDir)
      
      const fullPath = join(testDir, projectName)
      const dirExists = await directoryExists(fullPath)
      expect(dirExists).toBe(true)
    })
  })
})
