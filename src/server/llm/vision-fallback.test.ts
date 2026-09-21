import { describe, it, expect, beforeEach, vi } from 'vitest'
import { describeImage, describeImageFromDataUrl, isVisionFallbackFailure } from './vision-fallback.js'
import type { VisionModelConfig } from './vision-fallback.js'

global.fetch = vi.fn()

const ollamaVisionModel: VisionModelConfig = {
  baseUrl: 'http://localhost:11434',
  model: 'qwen3.5:0.8b',
  timeout: 120000,
  backend: 'ollama',
}

const openaiVisionModel: VisionModelConfig = {
  baseUrl: 'http://localhost:8000/v1',
  model: 'qwen3.5-27b',
  timeout: 120000,
  backend: 'openai',
}

describe('vision-fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetch).mockReset()
  })

  describe('describeImage (ollama)', () => {
    it('returns description from API', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ message: { content: 'A test image showing a cat' } }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const result = await describeImage('dGVzdA==', ollamaVisionModel)
      expect(result).toBe('A test image showing a cat')
    })

    it('calls /api/chat endpoint', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ message: { content: 'desc' } }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await describeImage('dGVzdA==', ollamaVisionModel)

      const callUrl = vi.mocked(fetch).mock.calls[0]?.[0]
      expect(callUrl).toBe('http://localhost:11434/api/chat')
    })

    it('sends Ollama request format with images field', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ message: { content: 'desc' } }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await describeImage('dGVzdA==', ollamaVisionModel)

      const callArgs = vi.mocked(fetch).mock.calls[0]!
      const body = JSON.parse(callArgs[1]?.body as string)
      expect(body.model).toBe('qwen3.5:0.8b')
      expect(body.stream).toBe(false)
      expect(body.messages[0].images).toEqual(['dGVzdA=='])
      expect(body.messages[0].content).toContain('Describe this image')
    })

    it('returns error message on API failure', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        text: async () => 'Internal error',
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const result = await describeImage('dGVzdA==', ollamaVisionModel)
      expect(result).toContain('HTTP 500')
    })

    it('is interrupted by external AbortSignal', async () => {
      const abortController = new AbortController()

      vi.mocked(fetch).mockImplementation(async (_url, init) => {
        return new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'))
            return
          }
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      })

      const resultPromise = describeImage('dGVzdA==', ollamaVisionModel, { signal: abortController.signal })

      abortController.abort()

      const result = await resultPromise
      expect(result).toContain('timed out')
    })

    it('includes context in the prompt when provided', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ message: { content: 'A test image' } }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await describeImage('dGVzdA==', ollamaVisionModel, { context: 'File: screenshot.png' })

      expect(fetch).toHaveBeenCalled()
      const callArgs = vi.mocked(fetch).mock.calls[0]!
      const body = JSON.parse(callArgs[1]?.body as string)
      expect(body.messages[0].content).toContain('File: screenshot.png')
    })
  })

  describe('describeImage (openai)', () => {
    it('returns description from API', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'A test image showing a diagram' } }],
        }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const result = await describeImage('dGVzdA==', openaiVisionModel)
      expect(result).toBe('A test image showing a diagram')
    })

    it('calls /v1/chat/completions endpoint', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'desc' } }] }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await describeImage('dGVzdA==', openaiVisionModel)

      const callUrl = vi.mocked(fetch).mock.calls[0]?.[0]
      expect(callUrl).toBe('http://localhost:8000/v1/chat/completions')
    })

    it('sends OpenAI request format with content array', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'desc' } }] }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await describeImage('dGVzdA==', openaiVisionModel)

      const callArgs = vi.mocked(fetch).mock.calls[0]!
      const body = JSON.parse(callArgs[1]?.body as string)
      expect(body.model).toBe('qwen3.5-27b')
      expect(body.messages).toHaveLength(1)
      expect(body.messages[0].role).toBe('user')
      expect(body.messages[0].content).toBeInstanceOf(Array)
      expect(body.messages[0].content[0].type).toBe('text')
      expect(body.messages[0].content[0].text).toContain('Describe this image')
      expect(body.messages[0].content[1].type).toBe('image_url')
      expect(body.messages[0].content[1].image_url.url).toBe('data:image/png;base64,dGVzdA==')
    })

    it('returns error message on API failure', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        text: async () => 'Bad request',
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const result = await describeImage('dGVzdA==', openaiVisionModel)
      expect(result).toContain('HTTP 400')
    })

    it('is interrupted by external AbortSignal', async () => {
      const abortController = new AbortController()

      vi.mocked(fetch).mockImplementation(async (_url, init) => {
        return new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'))
            return
          }
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      })

      const resultPromise = describeImage('dGVzdA==', openaiVisionModel, { signal: abortController.signal })

      abortController.abort()

      const result = await resultPromise
      expect(result).toContain('timed out')
    })

    it('includes context in the prompt when provided', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'desc' } }] }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await describeImage('dGVzdA==', openaiVisionModel, { context: 'File: screenshot.png' })

      const callArgs = vi.mocked(fetch).mock.calls[0]!
      const body = JSON.parse(callArgs[1]?.body as string)
      expect(body.messages[0].content[0].text).toContain('File: screenshot.png')
    })

    it('handles empty response content', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ choices: [{ message: { content: null } }] }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const result = await describeImage('dGVzdA==', openaiVisionModel)
      expect(result).toBe('[Image - could not describe]')
    })
  })

  describe('describeImage with a specific question', () => {
    it('uses the question as the prompt instead of the generic image prompt (ollama)', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ message: { content: 'It says "Save Changes".' } }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const result = await describeImage('dGVzdA==', ollamaVisionModel, {
        question: 'What does the button in the top-right say?',
      })

      expect(result).toBe('It says "Save Changes".')
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string)
      const prompt = body.messages[0].content
      expect(prompt).toContain('What does the button in the top-right say?')
      expect(prompt).not.toContain('Describe this image')
    })

    it('uses the question as the prompt instead of the generic image prompt (openai)', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'It says "Cancel".' } }] }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await describeImage('dGVzdA==', openaiVisionModel, { question: 'What does the cancel button say?' })

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string)
      const prompt = body.messages[0].content[0].text
      expect(prompt).toContain('What does the cancel button say?')
      expect(prompt).not.toContain('Describe this image')
    })

    it('prefers the question over context when both are provided (ollama)', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ message: { content: 'answer' } }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await describeImage('dGVzdA==', ollamaVisionModel, { question: 'Specific?', context: 'File: x.png' })

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string)
      const prompt = body.messages[0].content
      expect(prompt).toContain('Specific?')
      expect(prompt).not.toContain('File: x.png')
    })
  })

  describe('HTTP auth headers', () => {
    it('sends Authorization: Bearer header when apiKey is provided with openai backend', async () => {
      const modelWithKey: VisionModelConfig = {
        baseUrl: 'http://localhost:8000/v1',
        model: 'gpt-4o-vision',
        timeout: 120000,
        backend: 'openai',
        apiKey: 'sk-test-key-456',
      }
      const mockResponse = {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'desc' } }] }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await describeImage('dGVzdA==', modelWithKey)

      const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>
      expect(headers['Authorization']).toBe('Bearer sk-test-key-456')
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('does not send Authorization header when apiKey is not provided with openai backend', async () => {
      const modelWithoutKey: VisionModelConfig = {
        baseUrl: 'http://localhost:8000/v1',
        model: 'gpt-4o-vision',
        timeout: 120000,
        backend: 'openai',
      }
      const mockResponse = {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'desc' } }] }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await describeImage('dGVzdA==', modelWithoutKey)

      const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>
      expect(headers['Authorization']).toBeUndefined()
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('does not send Authorization header for ollama backend even when apiKey is provided', async () => {
      const ollamaModelWithKey: VisionModelConfig = {
        baseUrl: 'http://localhost:11434',
        model: 'llava',
        timeout: 120000,
        backend: 'ollama',
        apiKey: 'should-not-be-used',
      }
      const mockResponse = {
        ok: true,
        json: async () => ({ message: { content: 'desc' } }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      await describeImage('dGVzdA==', ollamaModelWithKey)

      const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>
      expect(headers['Authorization']).toBeUndefined()
      expect(headers['Content-Type']).toBe('application/json')
    })
  })

  describe('describeImageFromDataUrl', () => {
    it('extracts base64 from data URL (ollama)', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ message: { content: 'A test image' } }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const dataUrl = 'data:image/png;base64,dGVzdA=='
      const result = await describeImageFromDataUrl(dataUrl, ollamaVisionModel)
      expect(result).toBe('A test image')
    })

    it('extracts base64 from data URL (openai)', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'An image' } }] }),
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as unknown as Response)

      const dataUrl = 'data:image/png;base64,dGVzdA=='
      const result = await describeImageFromDataUrl(dataUrl, openaiVisionModel)
      expect(result).toBe('An image')
    })

    it('returns error for invalid data URL', async () => {
      const result = await describeImageFromDataUrl('not-a-data-url', ollamaVisionModel)
      expect(result).toBe('[Invalid image data URL]')
    })
  })

  describe('isVisionFallbackFailure', () => {
    it('detects every failure marker the fallback can return', () => {
      expect(isVisionFallbackFailure('[Image description failed: HTTP 503]')).toBe(true)
      expect(isVisionFallbackFailure('[Image description failed: aborted]')).toBe(true)
      expect(isVisionFallbackFailure('[Image description timed out]')).toBe(true)
      expect(isVisionFallbackFailure('[Image - could not describe]')).toBe(true)
      expect(isVisionFallbackFailure('[Invalid image data URL]')).toBe(true)
    })

    it('does not flag a normal description', () => {
      expect(isVisionFallbackFailure('A red square on a white background.')).toBe(false)
      expect(isVisionFallbackFailure('[Image: shot.png] It shows a chart.')).toBe(false)
    })
  })
})
