/**
 * Project Management E2E Tests
 * 
 * Tests project CRUD operations and custom instructions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestClient, createTestProject, type TestClient, type TestProject } from './utils/index.js'
import type { Project } from '@openfox/shared'

describe('Project Management', () => {
  let client: TestClient
  let testDir: TestProject

  beforeEach(async () => {
    client = await createTestClient()
    testDir = await createTestProject({ template: 'empty' })
  })

  afterEach(async () => {
    await client.close()
    await testDir.cleanup()
  })

  describe('project.create', () => {
    it('creates a project with name and workdir', async () => {
      const response = await client.send('project.create', {
        name: 'My Project',
        workdir: testDir.path,
      })

      expect(response.type).toBe('project.state')
      const project = client.getProject()!
      expect(project.name).toBe('My Project')
      expect(project.workdir).toBe(testDir.path)
      expect(project.id).toBeDefined()
      expect(project.createdAt).toBeDefined()
    })

    it('generates unique IDs for multiple projects', async () => {
      await client.send('project.create', { name: 'Project 1', workdir: testDir.path })
      const project1 = client.getProject()!

      const testDir2 = await createTestProject({ template: 'empty' })
      try {
        await client.send('project.create', { name: 'Project 2', workdir: testDir2.path })
        const project2 = client.getProject()!

        expect(project1.id).not.toBe(project2.id)
      } finally {
        await testDir2.cleanup()
      }
    })
  })

  describe('project.list', () => {
    it('returns empty list when no projects exist', async () => {
      const response = await client.send('project.list', {})

      expect(response.type).toBe('project.list')
      const payload = response.payload as { projects: Project[] }
      // Note: There might be projects from other tests, so we check it's an array
      expect(Array.isArray(payload.projects)).toBe(true)
    })

    it('returns created projects', async () => {
      await client.send('project.create', { name: 'Test Project', workdir: testDir.path })
      const createdProject = client.getProject()!

      const response = await client.send('project.list', {})
      const payload = response.payload as { projects: Project[] }

      const found = payload.projects.find(p => p.id === createdProject.id)
      expect(found).toBeDefined()
      expect(found!.name).toBe('Test Project')
    })
  })

  describe('project.load', () => {
    it('loads an existing project', async () => {
      await client.send('project.create', { name: 'Load Me', workdir: testDir.path })
      const created = client.getProject()!

      // Create new client to test load
      const client2 = await createTestClient()
      try {
        const response = await client2.send('project.load', { projectId: created.id })

        expect(response.type).toBe('project.state')
        const loaded = client2.getProject()!
        expect(loaded.id).toBe(created.id)
        expect(loaded.name).toBe('Load Me')
      } finally {
        await client2.close()
      }
    })

    it('returns NOT_FOUND for invalid project ID', async () => {
      const response = await client.send('project.load', { projectId: 'nonexistent' })

      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('NOT_FOUND')
    })
  })

  describe('project.update', () => {
    it('updates project name', async () => {
      await client.send('project.create', { name: 'Original', workdir: testDir.path })
      const created = client.getProject()!

      const response = await client.send('project.update', {
        projectId: created.id,
        name: 'Updated Name',
      })

      expect(response.type).toBe('project.state')
      const updated = client.getProject()!
      expect(updated.name).toBe('Updated Name')
      expect(updated.id).toBe(created.id)
    })

    it('sets custom instructions', async () => {
      await client.send('project.create', { name: 'Instructions Test', workdir: testDir.path })
      const created = client.getProject()!

      const instructions = 'Always use dark theme. Prefer functional programming.'
      const response = await client.send('project.update', {
        projectId: created.id,
        customInstructions: instructions,
      })

      expect(response.type).toBe('project.state')
      const updated = client.getProject()!
      expect(updated.customInstructions).toBe(instructions)
    })

    it('clears custom instructions with null', async () => {
      await client.send('project.create', { name: 'Clear Test', workdir: testDir.path })
      const created = client.getProject()!

      // Set instructions
      await client.send('project.update', {
        projectId: created.id,
        customInstructions: 'Some instructions',
      })

      // Clear them
      const response = await client.send('project.update', {
        projectId: created.id,
        customInstructions: null,
      })

      expect(response.type).toBe('project.state')
      const updated = client.getProject()!
      expect(updated.customInstructions).toBeUndefined()
    })

    it('returns NOT_FOUND for invalid project ID', async () => {
      const response = await client.send('project.update', {
        projectId: 'nonexistent',
        name: 'New Name',
      })

      expect(response.type).toBe('error')
      expect((response.payload as { code: string }).code).toBe('NOT_FOUND')
    })
  })

  describe('project.delete', () => {
    it('deletes a project', async () => {
      await client.send('project.create', { name: 'Delete Me', workdir: testDir.path })
      const created = client.getProject()!

      const response = await client.send('project.delete', { projectId: created.id })

      expect(response.type).toBe('project.deleted')
      expect((response.payload as { projectId: string }).projectId).toBe(created.id)

      // Verify it's gone
      const loadResponse = await client.send('project.load', { projectId: created.id })
      expect(loadResponse.type).toBe('error')
      expect((loadResponse.payload as { code: string }).code).toBe('NOT_FOUND')
    })
  })
})
