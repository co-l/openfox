import { describe, expect, it } from 'vitest'
import { hasVisionEvidence } from './vision.js'

describe('hasVisionEvidence', () => {
  it('detects vision via vision_start_token_id', () => {
    expect(hasVisionEvidence({ vision_start_token_id: 32000 })).toBe(true)
  })

  it('detects vision via a .vision key (e.g. clip.vision_projection)', () => {
    expect(hasVisionEvidence({ 'clip.vision_projection': { type: 'tensor' } })).toBe(true)
  })

  it('detects vision via a vision_ key', () => {
    expect(hasVisionEvidence({ 'some.vision_model': true })).toBe(true)
  })

  it('does not flag a text-only model', () => {
    expect(hasVisionEvidence({ 'general.architecture': 'qwen3' })).toBe(false)
  })

  it('does not flag an empty model_info', () => {
    expect(hasVisionEvidence({})).toBe(false)
  })
})
