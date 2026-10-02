import { describe, it, expect } from 'vitest'
import { PNG } from 'pngjs'
import { downscalePngDataUrl, MAX_IMAGE_DIMENSION } from './image-resize.js'

function makeSolidPngDataUrl(width: number, height: number): string {
  const png = new PNG({ width, height })
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = 200
    png.data[i * 4 + 1] = 30
    png.data[i * 4 + 2] = 80
    png.data[i * 4 + 3] = 255
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}

function makeGradientPngDataUrl(width: number, height: number): string {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      png.data[i] = Math.round((x * 255) / Math.max(1, width - 1))
      png.data[i + 1] = Math.round((y * 255) / Math.max(1, height - 1))
      png.data[i + 2] = 128
      png.data[i + 3] = 255
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}

function decode(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'))
}

describe('downscalePngDataUrl', () => {
  it('returns non-PNG data URLs unchanged', () => {
    const url = 'data:image/jpeg;base64,abc123'
    expect(downscalePngDataUrl(url)).toBe(url)
  })

  it('returns a small PNG unchanged (within the limit)', () => {
    const url = makeSolidPngDataUrl(100, 80)
    expect(downscalePngDataUrl(url)).toBe(url)
  })

  it('returns a PNG at exactly the limit unchanged', () => {
    const url = makeSolidPngDataUrl(MAX_IMAGE_DIMENSION, 800)
    expect(downscalePngDataUrl(url)).toBe(url)
  })

  it('downscales a large PNG so the largest side is at most MAX_IMAGE_DIMENSION', () => {
    const url = makeGradientPngDataUrl(3000, 2000)
    const result = downscalePngDataUrl(url)
    expect(result).not.toBe(url)
    const png = decode(result)
    expect(Math.max(png.width, png.height)).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION)
    expect(png.width).toBe(1568)
    expect(png.height).toBe(Math.round(2000 * (1568 / 3000)))
  })

  it('preserves the aspect ratio when downscaling', () => {
    const url = makeGradientPngDataUrl(2560, 1440)
    const png = decode(downscalePngDataUrl(url))
    expect(png.width / png.height).toBeCloseTo(2560 / 1440, 2)
  })

  it('reduces the payload size for a large gradient PNG', () => {
    const url = makeGradientPngDataUrl(2560, 1440)
    const result = downscalePngDataUrl(url)
    expect(result.length).toBeLessThan(url.length)
  })

  it('returns a corrupt PNG data URL unchanged', () => {
    const url = 'data:image/png;base64,not-a-valid-png'
    expect(downscalePngDataUrl(url)).toBe(url)
  })

  it('is deterministic (same input -> same output)', () => {
    const url = makeGradientPngDataUrl(2000, 1200)
    const a = downscalePngDataUrl(url)
    const b = downscalePngDataUrl(url)
    expect(a).toBe(b)
  })
})
