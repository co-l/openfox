import { PNG } from 'pngjs'

// Maximum dimension (pixels, largest side) for images sent to vision models.
// Screenshots larger than this are downscaled (bilinear) before being sent,
// which shrinks the base64 payload by 4-10x while staying well above the
// resolution a vision model needs to read UI text and icons.
export const MAX_IMAGE_DIMENSION = 1568

/**
 * Downscale a base64 PNG data URL so its largest side is at most
 * MAX_IMAGE_DIMENSION pixels. Returns the input unchanged when the image is
 * already within the limit, is not a PNG data URL, or cannot be decoded.
 *
 * Pure and synchronous — safe to call on the hot wire-conversion path.
 */
export function downscalePngDataUrl(dataUrl: string): string {
  const prefix = 'data:image/png;base64,'
  if (!dataUrl.startsWith(prefix)) return dataUrl

  let png: PNG
  try {
    png = PNG.sync.read(Buffer.from(dataUrl.slice(prefix.length), 'base64'))
  } catch {
    return dataUrl
  }

  const largest = Math.max(png.width, png.height)
  if (largest <= MAX_IMAGE_DIMENSION) return dataUrl

  const scale = MAX_IMAGE_DIMENSION / largest
  const newWidth = Math.max(1, Math.round(png.width * scale))
  const newHeight = Math.max(1, Math.round(png.height * scale))
  const src = png.data
  const sw = png.width
  const sh = png.height
  const out = new PNG({ width: newWidth, height: newHeight })
  const dst = out.data

  for (let y = 0; y < newHeight; y++) {
    const sy = y / scale
    const sy0 = Math.min(sh - 1, Math.floor(sy))
    const sy1 = Math.min(sh - 1, sy0 + 1)
    const fy = sy - sy0
    for (let x = 0; x < newWidth; x++) {
      const sx = x / scale
      const sx0 = Math.min(sw - 1, Math.floor(sx))
      const sx1 = Math.min(sw - 1, sx0 + 1)
      const fx = sx - sx0
      const i00 = (sy0 * sw + sx0) * 4
      const i10 = (sy0 * sw + sx1) * 4
      const i01 = (sy1 * sw + sx0) * 4
      const i11 = (sy1 * sw + sx1) * 4
      const o = (y * newWidth + x) * 4
      for (let c = 0; c < 4; c++) {
        const top = (src[i00 + c] ?? 0) * (1 - fx) + (src[i10 + c] ?? 0) * fx
        const bottom = (src[i01 + c] ?? 0) * (1 - fx) + (src[i11 + c] ?? 0) * fx
        dst[o + c] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }

  return `data:image/png;base64,${PNG.sync.write(out).toString('base64')}`
}
