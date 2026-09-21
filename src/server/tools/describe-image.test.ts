import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile, stat } from 'node:fs/promises'
import { describeImageTool, isDescribeImageEligible } from './describe-image.js'
import { describeImageFromDataUrl } from '../llm/vision-fallback.js'
import { loadResolvedVisionModel } from '../context/image-processor.js'
import { modelSupportsVision } from '../llm/profiles.js'
import { OUTPUT_LIMITS } from './types.js'
import type { ToolContext } from './types.js'

// A minimal PNG signature so detectImageType recognises it as image/png
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
])

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    readFile: vi.fn(),
    stat: vi.fn(),
  }
})

vi.mock('./file-tracker.js', () => ({
  computeFileHash: vi.fn().mockResolvedValue('test-hash'),
}))

vi.mock('../llm/vision-fallback.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm/vision-fallback.js')>()
  return {
    ...actual,
    describeImageFromDataUrl: vi.fn().mockResolvedValue('The fallback answer.'),
  }
})

vi.mock('../context/image-processor.js', () => ({
  loadResolvedVisionModel: vi.fn().mockResolvedValue({
    baseUrl: 'http://localhost:11434',
    model: 'llava',
    timeout: 120000,
    backend: 'ollama',
  }),
}))

vi.mock('../llm/profiles.js', () => ({
  modelSupportsVision: vi.fn().mockReturnValue(false),
}))

const mockSessionManager = {
  recordFileRead: vi.fn(),
} as any

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionManager: mockSessionManager,
    workdir: '/test/workdir',
    sessionId: 'test-session',
    ...(overrides.llmClient ? { llmClient: { getModel: () => 'non-vision-model' } as ToolContext['llmClient'] } : {}),
    ...overrides,
  } as ToolContext
}

describe('describeImageTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadResolvedVisionModel).mockResolvedValue({
      baseUrl: 'http://localhost:11434',
      model: 'llava',
      timeout: 120000,
      backend: 'ollama',
    })
    vi.mocked(modelSupportsVision).mockReturnValue(false)
  })

  it('asks the fallback model the question and returns the answer with rich metadata', async () => {
    vi.mocked(readFile).mockResolvedValue(PNG_SIGNATURE)
    vi.mocked(stat).mockResolvedValue({ size: 16 } as any)

    const result = await describeImageTool.execute(
      { path: 'screenshot.png', question: 'What does the top-right button say?' },
      makeContext(),
    )

    expect(result.success).toBe(true)
    expect(result.output).toBe('The fallback answer.')
    expect(result.metadata?.['description']).toBe('The fallback answer.')
    expect(result.metadata?.['question']).toBe('What does the top-right button say?')
    expect(result.metadata?.['mimeType']).toBe('image/png')
    expect(String(result.metadata?.['dataUrl'])).toContain('data:image/png;base64,')
    expect(String(result.metadata?.['path'])).toContain('screenshot.png')
    // The question is forwarded to the vision fallback
    expect(describeImageFromDataUrl).toHaveBeenCalledWith(expect.any(String), expect.anything(), {
      question: 'What does the top-right button say?',
      signal: undefined,
    })
    // File read is recorded for write validation
    expect(mockSessionManager.recordFileRead).toHaveBeenCalled()
  })

  it('errors when the question is empty', async () => {
    const result = await describeImageTool.execute({ path: 'screenshot.png', question: '   ' }, makeContext())
    expect(result.success).toBe(false)
    expect(String(result.error).toLowerCase()).toContain('question')
  })

  it('errors when the file is not found', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))
    const result = await describeImageTool.execute({ path: 'missing.png', question: 'What is this?' }, makeContext())
    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('not found')
  })

  it('errors when the file is not an image', async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from('plain text content'))
    vi.mocked(stat).mockResolvedValue({ size: 18 } as any)
    const result = await describeImageTool.execute({ path: 'notes.txt', question: 'What is this?' }, makeContext())
    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('Not an image')
  })

  it('errors when the image exceeds the size limit', async () => {
    vi.mocked(stat).mockResolvedValue({ size: OUTPUT_LIMITS.read_file.maxImageBytes + 1 } as any)
    const result = await describeImageTool.execute({ path: 'huge.png', question: 'What is this?' }, makeContext())
    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('image size limit')
  })

  it('errors when no vision fallback is configured', async () => {
    vi.mocked(loadResolvedVisionModel).mockResolvedValue(undefined)
    vi.mocked(readFile).mockResolvedValue(PNG_SIGNATURE)
    vi.mocked(stat).mockResolvedValue({ size: 16 } as any)
    const result = await describeImageTool.execute({ path: 'screenshot.png', question: 'What is this?' }, makeContext())
    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('vision fallback')
  })

  it('errors when the vision fallback returns a failure marker', async () => {
    vi.mocked(describeImageFromDataUrl).mockResolvedValue('[Image description failed: HTTP 503]')
    vi.mocked(readFile).mockResolvedValue(PNG_SIGNATURE)
    vi.mocked(stat).mockResolvedValue({ size: 16 } as any)
    const result = await describeImageTool.execute({ path: 'screenshot.png', question: 'What is this?' }, makeContext())
    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('failed')
  })

  it('errors when the active model supports vision', async () => {
    vi.mocked(modelSupportsVision).mockReturnValue(true)
    const result = await describeImageTool.execute(
      { path: 'screenshot.png', question: 'What is this?' },
      makeContext({ llmClient: { getModel: () => 'vision-model' } as ToolContext['llmClient'] }),
    )
    expect(result.success).toBe(false)
    expect(String(result.error).toLowerCase()).toContain('vision')
  })
})

describe('isDescribeImageEligible', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is false when the model name is unknown', async () => {
    expect(await isDescribeImageEligible(undefined)).toBe(false)
  })

  it('is false when the model supports vision', async () => {
    vi.mocked(modelSupportsVision).mockReturnValue(true)
    expect(await isDescribeImageEligible('gpt-4o')).toBe(false)
  })

  it('is true for a non-vision model with a configured fallback', async () => {
    vi.mocked(modelSupportsVision).mockReturnValue(false)
    vi.mocked(loadResolvedVisionModel).mockResolvedValue({
      baseUrl: 'http://localhost:11434',
      model: 'llava',
      timeout: 1000,
      backend: 'ollama',
    })
    expect(await isDescribeImageEligible('llama3')).toBe(true)
  })

  it('is false for a non-vision model with no fallback configured', async () => {
    vi.mocked(modelSupportsVision).mockReturnValue(false)
    vi.mocked(loadResolvedVisionModel).mockResolvedValue(undefined)
    expect(await isDescribeImageEligible('llama3')).toBe(false)
  })
})
