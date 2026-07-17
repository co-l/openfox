import { describe, expect, it } from 'vitest'
import { mergeMetadata } from './crud-helpers.js'

describe('mergeMetadata', () => {
  it('removes fields explicitly set to null', () => {
    expect(
      mergeMetadata(
        { id: 'planner', name: 'Planner', modelCascade: [{ providerId: 'a', model: 'first' }] },
        { modelCascade: null },
        'planner',
      ),
    ).toEqual({ id: 'planner', name: 'Planner' })
  })
})
