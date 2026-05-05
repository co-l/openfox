import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TestProject {
  projectId: string
  workdir: string
  cleanup: () => Promise<void>
}

export async function createTestProjectWithReadme(
  baseUrl: string,
  name: string = 'Test Project',
): Promise<TestProject> {
  // Create temporary directory
  const workdir = join(tmpdir(), `openfox-test-${Date.now()}`)
  await mkdir(workdir, { recursive: true })

  // Create minimal README.md
  await writeFile(join(workdir, 'README.md'), '# Test Project\n\nThis is a test project.\n')

  // Create project via REST API
  const response = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      workdir,
    }),
  })

  if (!response.ok) {
    await rm(workdir, { recursive: true, force: true })
    throw new Error('Failed to create test project')
  }

  const data = await response.json()
  const projectId = data.project.id

  return {
    projectId,
    workdir,
    cleanup: async () => {
      await rm(workdir, { recursive: true, force: true })
    },
  }
}
