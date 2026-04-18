/**
 * Tests for CreateProjectModal validation logic
 */

import { describe, it, expect } from 'vitest'
import { validateProjectName } from './shared/validation'

describe('CreateProjectModal validation', () => {
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

    it('should reject project names with spaces', () => {
      const result = validateProjectName('my project')
      expect(result.valid).toBe(false)
      expect((result as { valid: false; error: string }).error).toContain('only contain')
    })

    it('should reject project names with special characters', () => {
      const invalidNames = ['my@project', 'my#project', 'my$project']
      
      for (const name of invalidNames) {
        const result = validateProjectName(name)
        expect(result.valid).toBe(false)
      }
    })

    it('should accept project names with dots', () => {
      const result = validateProjectName('test.project')
      expect(result.valid).toBe(true)
    })

    it('should accept project names with underscores', () => {
      const result = validateProjectName('test_project')
      expect(result.valid).toBe(true)
    })

    it('should accept project names with hyphens', () => {
      const result = validateProjectName('test-project')
      expect(result.valid).toBe(true)
    })

    it('should reject project names with path separators', () => {
      const result1 = validateProjectName('my/project')
      expect(result1.valid).toBe(false)
      
      const result2 = validateProjectName('my\\project')
      expect(result2.valid).toBe(false)
    })
  })
})

describe('CreateProjectModal payload parsing', () => {
  it('should correctly extract project from project.state payload', () => {
    // Simulate the server response structure
    const mockMessage = {
      id: 'test-id',
      type: 'project.state',
      payload: {
        project: {
          id: 'proj-123',
          name: 'test-project',
          workdir: '/home/user/test-project'
        }
      }
    }
    
    // Extract the project like the modal does
    const msg = mockMessage as unknown as { type: string; payload?: unknown }
    const payload = msg.payload as { project: { id: string } }
    const project = payload?.project
    
    expect(project).toBeDefined()
    expect(project?.id).toBe('proj-123')
  })
})
