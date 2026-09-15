import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { closeDatabase, initDatabase } from '../db/index.js'
import { createProject } from '../db/projects.js'
import { createTasksService, type TasksService } from '../tasks/service.js'
import { projectTasksTool, setTasksService } from './project-tasks.js'
import { OUTPUT_LIMITS } from './types.js'
import type { ToolContext } from './types.js'

function makeContext(projectId: string): ToolContext {
  return {
    workdir: '/tmp',
    sessionId: 'sess-agent',
    sessionManager: {
      getSession: (id: string) => (id === 'sess-agent' ? { id, projectId } : null),
    } as unknown as ToolContext['sessionManager'],
  }
}

async function execute(action: string, args: Record<string, unknown>, projectId: string) {
  const ctx = makeContext(projectId)
  const result = await projectTasksTool.execute({ action, ...args }, ctx)
  return result
}

describe('project_tasks tool', () => {
  let root: string
  let projectId: string
  let service: TasksService

  beforeEach(async () => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
    root = await mkdtemp(join(tmpdir(), 'openfox-tool-tasks-'))
    await mkdir(join(root, 'nested'), { recursive: true })
    projectId = createProject('Tool Tasks', root).id

    const svc = createTasksService({
      sessionManager: {
        getSession: () => null,
        createSession: () => ({ id: 'unused' }),
        addMessage: () => undefined,
        queueMessage: () => undefined,
      } as unknown as Parameters<typeof createTasksService>[0]['sessionManager'],
      config: loadConfig(),
      broadcast: () => undefined,
      configDir: root,
    })
    service = svc
    setTasksService(svc)
  })

  afterEach(async () => {
    closeDatabase()
    await rm(root, { recursive: true, force: true })
  })

  it('creates a task with full parity', async () => {
    const result = await execute('create', { prompt: 'Write the docs' }, projectId)
    expect(result.success).toBe(true)
    const task = JSON.parse(result.output!) as { id: string; status: string; prompt: string }
    expect(task.status).toBe('todo')
    expect(task.prompt).toBe('Write the docs')
  })

  it('lists tasks and gate config', async () => {
    await execute('create', { prompt: 'A task' }, projectId)
    const result = await execute('list', {}, projectId)
    expect(result.success).toBe(true)
    const parsed = JSON.parse(result.output!) as { tasks: unknown[]; gates: unknown[] }
    expect(parsed.tasks).toHaveLength(1)
    expect(Array.isArray(parsed.gates)).toBe(true)
  })

  it('agent move binds the current session and surfaces the active session', async () => {
    const created = await execute('create', { prompt: 'Do it' }, projectId)
    const task = JSON.parse(created.output!) as { id: string }
    const moved = await execute('move', { taskId: task.id, to: 'in_progress' }, projectId)
    expect(moved.success).toBe(true)
    const movedTask = JSON.parse(moved.output!) as { boundSession: string; status: string }
    expect(movedTask.boundSession).toBe('sess-agent')
    expect(movedTask.status).toBe('in_progress')
  })

  it('list excludes done tasks by default and supports a status filter', async () => {
    const created = await execute('create', { prompt: 'Ship it' }, projectId)
    const task = JSON.parse(created.output!) as { id: string }
    await execute('move', { taskId: task.id, to: 'in_progress' }, projectId)
    await execute('move', { taskId: task.id, to: 'done' }, projectId)

    const open = await execute('list', {}, projectId)
    const openParsed = JSON.parse(open.output!) as { tasks: unknown[] }
    expect(openParsed.tasks).toHaveLength(0)

    const done = await execute('list', { status: 'done' }, projectId)
    const doneParsed = JSON.parse(done.output!) as { tasks: { id: string; status: string }[] }
    expect(doneParsed.tasks).toHaveLength(1)
    expect(doneParsed.tasks[0]!.status).toBe('done')

    const all = await execute('list', { status: 'all' }, projectId)
    const allParsed = JSON.parse(all.output!) as { tasks: unknown[] }
    expect(allParsed.tasks).toHaveLength(1)
  })

  it('list paginates by default with limit 10, total, and hasMore', async () => {
    for (let i = 0; i < 12; i++) {
      service.create(projectId, { prompt: `Task ${i}` }, { actor: 'human' })
    }
    const result = await execute('list', {}, projectId)
    expect(result.success).toBe(true)
    const parsed = JSON.parse(result.output!) as {
      tasks: unknown[]
      total: number
      limit: number
      offset: number
      hasMore: boolean
    }
    expect(parsed.tasks).toHaveLength(10)
    expect(parsed.total).toBe(12)
    expect(parsed.limit).toBe(10)
    expect(parsed.offset).toBe(0)
    expect(parsed.hasMore).toBe(true)
  })

  it('list supports offset paging to the remaining tasks', async () => {
    for (let i = 0; i < 12; i++) {
      service.create(projectId, { prompt: `Task ${i}` }, { actor: 'human' })
    }
    const result = await execute('list', { offset: 10 }, projectId)
    expect(result.success).toBe(true)
    const parsed = JSON.parse(result.output!) as { tasks: unknown[]; total: number; hasMore: boolean }
    expect(parsed.tasks).toHaveLength(2)
    expect(parsed.total).toBe(12)
    expect(parsed.hasMore).toBe(false)
  })

  it('list honors an explicit limit and rejects one above the cap', async () => {
    for (let i = 0; i < 5; i++) {
      service.create(projectId, { prompt: `Task ${i}` }, { actor: 'human' })
    }
    const limited = await execute('list', { limit: 3 }, projectId)
    expect(limited.success).toBe(true)
    const parsed = JSON.parse(limited.output!) as { tasks: unknown[]; limit: number }
    expect(parsed.tasks).toHaveLength(3)
    expect(parsed.limit).toBe(3)

    const over = await execute('list', { limit: 26 }, projectId)
    expect(over.success).toBe(false)
    expect(over.error).toContain('limit')
  })

  it('list applies the status filter before pagination', async () => {
    for (let i = 0; i < 12; i++) {
      service.create(projectId, { prompt: `Task ${i}` }, { actor: 'human' })
    }
    const listed = await execute('list', {}, projectId)
    const tasks = (JSON.parse(listed.output!) as { tasks: { id: string }[] }).tasks
    await execute('move', { taskId: tasks[0]!.id, to: 'in_progress' }, projectId)
    await execute('move', { taskId: tasks[0]!.id, to: 'done' }, projectId)

    const all = await execute('list', { status: 'all', limit: 5 }, projectId)
    const allParsed = JSON.parse(all.output!) as { tasks: unknown[]; total: number; hasMore: boolean }
    expect(allParsed.total).toBe(12)
    expect(allParsed.tasks).toHaveLength(5)
    expect(allParsed.hasMore).toBe(true)

    const done = await execute('list', { status: 'done' }, projectId)
    const doneParsed = JSON.parse(done.output!) as { tasks: unknown[]; total: number }
    expect(doneParsed.tasks).toHaveLength(1)
    expect(doneParsed.total).toBe(1)
  })

  it('rejects invalid limit and offset values with a clear error', async () => {
    for (const bad of [{ limit: 0 }, { limit: -1 }, { limit: 1.5 }]) {
      const result = await execute('list', bad, projectId)
      expect(result.success).toBe(false)
      expect(result.error).toContain('limit')
    }
    const badOffset = await execute('list', { offset: -1 }, projectId)
    expect(badOffset.success).toBe(false)
    expect(badOffset.error).toContain('offset')
  })

  it('list with a single status column returns only that column', async () => {
    const created = await execute('create', { prompt: 'Two states' }, projectId)
    const task = JSON.parse(created.output!) as { id: string }
    await execute('move', { taskId: task.id, to: 'in_progress' }, projectId)

    const todo = await execute('list', { status: 'todo' }, projectId)
    expect(JSON.parse(todo.output!) as { tasks: unknown[] }).toMatchObject({ tasks: [] })
    const progress = await execute('list', { status: 'in_progress' }, projectId)
    const parsed = JSON.parse(progress.output!) as { tasks: { id: string }[] }
    expect(parsed.tasks).toHaveLength(1)
    expect(parsed.tasks[0]!.id).toBe(task.id)
  })

  it('rejects an invalid status filter with a clear error', async () => {
    const result = await execute('list', { status: 'archived' }, projectId)
    expect(result.success).toBe(false)
    expect(result.error).toContain('status')
  })

  it('surfaces the queue position of a queued task in list', async () => {
    // Agent moves always run, so seed the queued state via a human move:
    // first task occupies the single slot, the second queues behind it.
    const a = service.create(projectId, { prompt: 'A' }, { actor: 'human' })
    const b = service.create(projectId, { prompt: 'B' }, { actor: 'human' })
    await service.move(projectId, a.id, 'in_progress', { actor: 'human' })
    await service.move(projectId, b.id, 'in_progress', { actor: 'human' })

    const list = await execute('list', {}, projectId)
    const parsed = JSON.parse(list.output!) as { tasks: { id: string; queuePosition?: number; runState?: string }[] }
    const queued = parsed.tasks.find((t) => t.id === b.id)!
    expect(queued.runState).toBe('queued')
    expect(queued.queuePosition).toBe(1)
    // The running task has no queue position in the agent's view.
    const running = parsed.tasks.find((t) => t.id === a.id)!
    expect(running.queuePosition).toBeUndefined()
  })

  it('returns a structured gate error telling the agent to fill fields first', async () => {
    service.setGateConfig(
      projectId,
      [{ id: 'commit', name: 'Commit', description: 'need a commit sha', required: true, variant: 'done' }],
      { actor: 'human' },
    )
    const created = await execute('create', { prompt: 'Ship' }, projectId)
    const task = JSON.parse(created.output!) as { id: string }
    await execute('move', { taskId: task.id, to: 'in_progress' }, projectId)

    const moved = await execute('move', { taskId: task.id, to: 'done' }, projectId)
    expect(moved.success).toBe(false)
    expect(moved.error).toContain('commit')
    expect(moved.error).toContain('set_gate_value')

    const filled = await execute('set_gate_value', { taskId: task.id, gateId: 'commit', value: 'abc123' }, projectId)
    expect(filled.success).toBe(true)
    const movedAgain = await execute('move', { taskId: task.id, to: 'done' }, projectId)
    expect(movedAgain.success).toBe(true)
  })

  it('denies a move when only the list action is permitted', async () => {
    const created = await execute('create', { prompt: 'Secret work' }, projectId)
    const task = JSON.parse(created.output!) as { id: string }

    const ctx = {
      ...makeContext(projectId),
      permittedActions: { project_tasks: ['list'] },
    }
    const denied = await projectTasksTool.execute({ action: 'move', taskId: task.id, to: 'in_progress' }, ctx)
    expect(denied.success).toBe(false)
    expect(denied.error).toContain('not allowed')
  })

  it('reports CONFLICT for a stale move', async () => {
    const created = await execute('create', { prompt: 'Race' }, projectId)
    const task = JSON.parse(created.output!) as { id: string; version: number }
    const stale = task.version
    await execute('edit', { taskId: task.id, prompt: 'Renamed' }, projectId)

    const moved = await execute('move', { taskId: task.id, to: 'in_progress', expectedVersion: stale }, projectId)
    expect(moved.success).toBe(false)
    expect(moved.error).toContain('refresh and retry')
  })

  it('deletes a task', async () => {
    const created = await execute('create', { prompt: 'Original' }, projectId)
    const task = JSON.parse(created.output!) as { id: string }
    const del = await execute('delete', { taskId: task.id }, projectId)
    expect(del.success).toBe(true)
    const deleted = JSON.parse(del.output!) as { message: string; prompt: string }
    expect(deleted.message).toBe('Deleted: Original')
    expect(deleted.prompt).toBe('Original')
    const list = await execute('list', {}, projectId)
    const parsed = JSON.parse(list.output!) as { tasks: { prompt: string }[] }
    expect(parsed.tasks).toHaveLength(0)
  })

  it('rejects actions removed from the agent surface', async () => {
    for (const action of ['get', 'duplicate', 'reorder', 'set_gates']) {
      const result = await execute(action, { taskId: 'x' }, projectId)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid action')
    }
  })

  // ------------------------------------------------------------------
  // get_attachment: reading task attachments through the tool
  // ------------------------------------------------------------------

  const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const PNG_SIZE = Buffer.from(PNG_1PX, 'base64').length

  function makePdfWithText(): Buffer {
    const stream = 'BT /F1 12 Tf 100 700 Td (Hello World PDF test) Tj ET'
    const len = Buffer.byteLength(stream, 'latin1')
    return Buffer.from(
      `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length ${len}>>stream\n${stream}\nendstream\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000061 00000 n \n0000000114 00000 n \n0000000268 00000 n \n0000000342 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n428\n%%EOF`,
      'latin1',
    )
  }

  function makeEmptyPdf(): Buffer {
    const stream = 'BT /F1 12 Tf 100 700 Td () Tj ET'
    const len = Buffer.byteLength(stream, 'latin1')
    return Buffer.from(
      `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n5 0 obj<</Length ${len}>>stream\n${stream}\nendstream\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000061 00000 n \n0000000114 00000 n \n0000000268 00000 n \n0000000342 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n426\n%%EOF`,
      'latin1',
    )
  }

  it('list exposes per-attachment metadata via attachmentList while keeping the numeric count', async () => {
    service.create(
      projectId,
      {
        prompt: 'With attachments',
        attachments: [
          { id: 'att-1', filename: 'notes.txt', mimeType: 'text/plain', size: 11, data: 'hello world' },
          {
            id: 'att-2',
            filename: 'pic.png',
            mimeType: 'image/png',
            size: PNG_SIZE,
            data: `data:image/png;base64,${PNG_1PX}`,
          },
        ],
      },
      { actor: 'human' },
    )
    service.create(projectId, { prompt: 'Bare' }, { actor: 'human' })

    const list = await execute('list', {}, projectId)
    const parsed = JSON.parse(list.output!) as {
      tasks: {
        prompt: string
        attachments?: number
        attachmentList?: { id: string; filename: string; mimeType: string; size: number }[]
      }[]
    }
    const withAtts = parsed.tasks.find((t) => t.prompt === 'With attachments')!
    expect(withAtts.attachments).toBe(2)
    expect(withAtts.attachmentList).toEqual([
      { id: 'att-1', filename: 'notes.txt', mimeType: 'text/plain', size: 11 },
      { id: 'att-2', filename: 'pic.png', mimeType: 'image/png', size: PNG_SIZE },
    ])
    const bare = parsed.tasks.find((t) => t.prompt === 'Bare')!
    expect(bare.attachments).toBe(0)
    expect(bare.attachmentList).toBeUndefined()
  })

  it('get_attachment returns a text attachment decoded from its data URL', async () => {
    const body = 'hello world'
    const created = await execute(
      'create',
      {
        prompt: 'Text file',
        attachments: [
          {
            id: 'att-1',
            filename: 'notes.txt',
            mimeType: 'text/plain',
            size: body.length,
            data: `data:text/plain;base64,${Buffer.from(body).toString('base64')}`,
          },
        ],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(true)
    expect(result.output).toBe(body)
  })

  it('get_attachment falls back to raw data when no data URL is present', async () => {
    const created = await execute(
      'create',
      {
        prompt: 'Raw text',
        attachments: [{ id: 'att-1', filename: 'memo.txt', mimeType: 'text/plain', size: 12, data: 'raw content' }],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(true)
    expect(result.output).toBe('raw content')
  })

  it('get_attachment returns exact text MIMEs (json, yaml) inline, not as unsupported', async () => {
    const jsonBody = '{"open":true}'
    const yamlBody = 'open: true'
    const created = await execute(
      'create',
      {
        prompt: 'Config exports',
        attachments: [
          {
            id: 'att-1',
            filename: 'config.json',
            mimeType: 'application/json',
            size: jsonBody.length,
            data: `data:application/json;base64,${Buffer.from(jsonBody).toString('base64')}`,
          },
          {
            id: 'att-2',
            filename: 'settings.yaml',
            mimeType: 'application/yaml',
            size: yamlBody.length,
            data: yamlBody,
          },
        ],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }

    const json = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(json.success).toBe(true)
    expect(json.output).toBe(jsonBody)

    const yaml = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-2' }, projectId)
    expect(yaml.success).toBe(true)
    expect(yaml.output).toBe(yamlBody)
  })

  it('get_attachment routes oversized images back to the user, not to a tool the agent lacks', async () => {
    const huge = Buffer.alloc(OUTPUT_LIMITS.read_file.maxImageBytes + 1024, 1)
    const created = await execute(
      'create',
      {
        prompt: 'Huge image',
        attachments: [
          {
            id: 'att-1',
            filename: 'huge.png',
            mimeType: 'image/png',
            size: huge.length,
            data: `data:image/png;base64,${huge.toString('base64')}`,
          },
        ],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(false)
    expect(result.error).toContain('re-upload')
  })

  it('get_attachment truncates long text at the read_file byte limit', async () => {
    const big = 'x'.repeat(OUTPUT_LIMITS.read_file.maxBytes + 50_000)
    const created = await execute(
      'create',
      {
        prompt: 'Big text',
        attachments: [
          {
            id: 'att-1',
            filename: 'big.txt',
            mimeType: 'text/plain',
            size: big.length,
            data: `data:text/plain;base64,${Buffer.from(big).toString('base64')}`,
          },
        ],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.output).toContain('[Output truncated due to size limit]')
    expect(result.output!.length).toBeLessThanOrEqual(OUTPUT_LIMITS.read_file.maxBytes + 50)
    expect(result.output!.startsWith('xxxxx')).toBe(true)
  })

  it('get_attachment returns an image in the read_file image shape with description passthrough', async () => {
    const created = await execute(
      'create',
      {
        prompt: 'Screenshot',
        attachments: [
          {
            id: 'att-1',
            filename: 'screenshot.png',
            mimeType: 'image/png',
            size: PNG_SIZE,
            data: `data:image/png;base64,${PNG_1PX}`,
            description: 'A red square',
          },
        ],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(true)
    expect(result.output).toContain('[Attachment: screenshot.png')
    expect(result.metadata).toMatchObject({
      mimeType: 'image/png',
      size: PNG_SIZE,
      base64Data: PNG_1PX,
      dataUrl: `data:image/png;base64,${PNG_1PX}`,
      path: 'screenshot.png',
      description: 'A red square',
    })
  })

  it('get_attachment omits description from image metadata when the attachment has none', async () => {
    const created = await execute(
      'create',
      {
        prompt: 'Screenshot',
        attachments: [
          {
            id: 'att-1',
            filename: 'screenshot.png',
            mimeType: 'image/png',
            size: PNG_SIZE,
            data: `data:image/png;base64,${PNG_1PX}`,
          },
        ],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(true)
    expect(result.metadata?.['description']).toBeUndefined()
  })

  it('get_attachment returns enriched pdfContent when present', async () => {
    const created = await execute(
      'create',
      {
        prompt: 'Doc',
        attachments: [
          {
            id: 'att-1',
            filename: 'doc.pdf',
            mimeType: 'application/pdf',
            size: 100,
            data: `data:application/pdf;base64,${makePdfWithText().toString('base64')}`,
            pdfContent: 'Enriched PDF text — page one.',
          },
        ],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(true)
    expect(result.output).toBe('Enriched PDF text — page one.')
  })

  it('get_attachment extracts text from a PDF buffer', async () => {
    const pdf = makePdfWithText()
    const created = await execute(
      'create',
      {
        prompt: 'Doc',
        attachments: [
          {
            id: 'att-1',
            filename: 'doc.pdf',
            mimeType: 'application/pdf',
            size: pdf.length,
            data: `data:application/pdf;base64,${pdf.toString('base64')}`,
          },
        ],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(true)
    expect(result.output).toContain('Hello World PDF test')
    expect(result.metadata).toMatchObject({ format: 'pdf', pageCount: 1 })
  })

  it('get_attachment surfaces the scanned-PDF placeholder when there is no text layer', async () => {
    const pdf = makeEmptyPdf()
    const created = await execute(
      'create',
      {
        prompt: 'Scanned doc',
        attachments: [
          {
            id: 'att-1',
            filename: 'scan.pdf',
            mimeType: 'application/pdf',
            size: pdf.length,
            data: `data:application/pdf;base64,${pdf.toString('base64')}`,
          },
        ],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(true)
    expect(result.output).toContain('no text layer')
    expect(result.metadata).toMatchObject({ format: 'pdf', path: 'scan.pdf' })
  })

  it('get_attachment reports a structured error for an unknown task', async () => {
    const result = await execute('get_attachment', { taskId: 'nope', attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('get_attachment rejects a task with no attachments', async () => {
    const created = await execute('create', { prompt: 'Bare' }, projectId)
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(false)
    expect(result.error).toContain('no attachments')
  })

  it('get_attachment lists the available attachments when the id is unknown', async () => {
    const created = await execute(
      'create',
      {
        prompt: 'Two files',
        attachments: [
          { id: 'att-1', filename: 'notes.txt', mimeType: 'text/plain', size: 5, data: 'abcde' },
          {
            id: 'att-2',
            filename: 'pic.png',
            mimeType: 'image/png',
            size: PNG_SIZE,
            data: `data:image/png;base64,${PNG_1PX}`,
          },
        ],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-3' }, projectId)
    expect(result.success).toBe(false)
    expect(result.error).toContain('att-1 (notes.txt)')
    expect(result.error).toContain('att-2 (pic.png)')
  })

  it('get_attachment rejects images over the read_file size cap', async () => {
    const huge = Buffer.alloc(OUTPUT_LIMITS.read_file.maxImageBytes + 1024, 1)
    const created = await execute(
      'create',
      {
        prompt: 'Huge image',
        attachments: [
          {
            id: 'att-1',
            filename: 'huge.png',
            mimeType: 'image/png',
            size: huge.length,
            data: `data:image/png;base64,${huge.toString('base64')}`,
          },
        ],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(false)
    expect(result.error).toContain('size limit')
  })

  it('get_attachment rejects corrupt image data', async () => {
    const created = await execute(
      'create',
      {
        prompt: 'Broken image',
        attachments: [{ id: 'att-1', filename: 'broken.png', mimeType: 'image/png', size: 12, data: 'not-a-data-url' }],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(false)
    expect(result.error).toContain('corrupt')
  })

  it('get_attachment rejects unsupported attachment types', async () => {
    const created = await execute(
      'create',
      {
        prompt: 'Archive',
        attachments: [{ id: 'att-1', filename: 'blob.zip', mimeType: 'application/zip', size: 5, data: 'abcde' }],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }
    const result = await execute('get_attachment', { taskId: task.id, attachmentId: 'att-1' }, projectId)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unsupported attachment type')
  })

  it('get_attachment requires taskId and attachmentId', async () => {
    const noTask = await execute('get_attachment', { attachmentId: 'att-1' }, projectId)
    expect(noTask.success).toBe(false)
    expect(noTask.error).toContain('taskId')

    const created = await execute('create', { prompt: 'Has file' }, projectId)
    const task = JSON.parse(created.output!) as { id: string }
    const noAttachment = await execute('get_attachment', { taskId: task.id }, projectId)
    expect(noAttachment.success).toBe(false)
    expect(noAttachment.error).toContain('attachmentId')
  })

  it('denies get_attachment when only the list action is permitted', async () => {
    const created = await execute(
      'create',
      {
        prompt: 'Has file',
        attachments: [{ id: 'att-1', filename: 'notes.txt', mimeType: 'text/plain', size: 5, data: 'abcde' }],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }

    const ctx = {
      ...makeContext(projectId),
      permittedActions: { project_tasks: ['list'] },
    }
    const denied = await projectTasksTool.execute(
      { action: 'get_attachment', taskId: task.id, attachmentId: 'att-1' },
      ctx,
    )
    expect(denied.success).toBe(false)
    expect(denied.error).toContain('not allowed')
  })

  it('grants get_attachment to an agent restricted to exactly that action', async () => {
    const created = await execute(
      'create',
      {
        prompt: 'Has file',
        attachments: [{ id: 'att-1', filename: 'notes.txt', mimeType: 'text/plain', size: 5, data: 'abcde' }],
      },
      projectId,
    )
    const task = JSON.parse(created.output!) as { id: string }

    const ctx = {
      ...makeContext(projectId),
      permittedActions: { project_tasks: ['get_attachment'] },
    }
    const allowed = await projectTasksTool.execute(
      { action: 'get_attachment', taskId: task.id, attachmentId: 'att-1' },
      ctx,
    )
    expect(allowed.success).toBe(true)
    expect(allowed.output).toBe('abcde')

    const deniedList = await projectTasksTool.execute({ action: 'list' }, ctx)
    expect(deniedList.success).toBe(false)
    expect(deniedList.error).toContain('not allowed')
  })

  it('keeps the LLM-facing definition lean', () => {
    const desc = projectTasksTool.definition.function.description
    expect(desc.length).toBeLessThanOrEqual(1200)
    expect(desc).toContain('get_attachment')
    for (const removed of ['duplicate', 'reorder', 'set_gates']) {
      expect(desc).not.toContain(removed)
    }
  })
})
