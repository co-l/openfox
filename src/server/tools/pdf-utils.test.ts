import { describe, it, expect } from 'vitest'
import { encodeImageToDataUrl, type RawImageData } from './pdf-utils.js'

const hasOffscreenCanvas = typeof (globalThis as Record<string, unknown>)['OffscreenCanvas'] !== 'undefined'

describe('encodeImageToDataUrl', () => {
  it('should encode RGB pixels to data URL', () => {
    const w = 2,
      h = 2
    const data = new Uint8Array(w * h * 3)
    data[0] = 255
    data[1] = 0
    data[2] = 0
    data[3] = 0
    data[4] = 255
    data[5] = 0
    data[6] = 0
    data[7] = 0
    data[8] = 255
    data[9] = 128
    data[10] = 128
    data[11] = 128

    const img: RawImageData = { width: w, height: h, data, kind: 2 }
    const result = encodeImageToDataUrl(img)
    expect(result).toBeTruthy()
    expect(result).toMatch(/^data:image\/png;base64,/)
  })

  it('should encode RGBA pixels to data URL', () => {
    const w = 2,
      h = 2
    const data = new Uint8Array(w * h * 4)
    data[0] = 255
    data[1] = 0
    data[2] = 0
    data[3] = 255

    const img: RawImageData = { width: w, height: h, data, kind: 3 }
    const result = encodeImageToDataUrl(img)
    expect(result).toBeTruthy()
    expect(result).toMatch(/^data:image\/png;base64,/)
  })

  it('should return null when data is null and no bitmap', () => {
    const img = { width: 10, height: 10, data: null, kind: 0 } as unknown as RawImageData
    const result = encodeImageToDataUrl(img)
    expect(result).toBeNull()
  })

  it('should return null for oversized images', () => {
    const size = Math.ceil(Math.sqrt(20_971_521 / 4))
    const data = new Uint8Array(size * size * 4)
    const img: RawImageData = { width: size, height: size, data, kind: 3 }
    const result = encodeImageToDataUrl(img)
    expect(result).toBeNull()
  })

  it('should downscale oversized dimensions', () => {
    const data = new Uint8Array(2000 * 2000 * 3)
    const img: RawImageData = { width: 2000, height: 2000, data, kind: 2 }
    const result = encodeImageToDataUrl(img, 1024)
    expect(result).toBeTruthy()
    expect(result).toMatch(/^data:image\/png;base64,/)
  })

  it('should handle 1-bit grayscale pixels', () => {
    const w = 8,
      h = 1
    const data = new Uint8Array([0b10101010])
    const img: RawImageData = { width: w, height: h, data, kind: 1 }
    const result = encodeImageToDataUrl(img)
    expect(result).toBeTruthy()
    expect(result).toMatch(/^data:image\/png;base64,/)
  })

  if (hasOffscreenCanvas) {
    it('should convert ImageBitmap to data URL when no data array', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const OC = (globalThis as Record<string, unknown>)['OffscreenCanvas'] as new (w: number, h: number) => any
      const canvas = new OC(3, 3)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = 'red'
      ctx.fillRect(0, 0, 1, 1)
      ctx.fillStyle = 'lime'
      ctx.fillRect(1, 0, 1, 1)
      ctx.fillStyle = 'blue'
      ctx.fillRect(2, 0, 1, 1)
      const bitmap = canvas.transferToImageBitmap()

      const img: RawImageData = { width: 3, height: 3, data: new Uint8Array(), kind: 0, bitmap }
      const result = encodeImageToDataUrl(img)
      expect(result).toBeTruthy()
      expect(result).toMatch(/^data:image\/png;base64,/)
      bitmap.close()
    })

    it('should downsample bitmap-based image', async () => {
      const OC = (globalThis as Record<string, unknown>)['OffscreenCanvas'] as new (w: number, h: number) => any
      const canvas = new OC(2000, 1000)
      const ctx = canvas.getContext('2d')!
      ctx.fillRect(0, 0, 2000, 1000)
      const bitmap = canvas.transferToImageBitmap()

      const img: RawImageData = { width: 2000, height: 1000, data: new Uint8Array(), kind: 0, bitmap }
      const result = encodeImageToDataUrl(img, 1024)
      expect(result).toBeTruthy()
      expect(result).toMatch(/^data:image\/png;base64,/)
      bitmap.close()
    })
  }
})
