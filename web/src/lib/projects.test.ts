import { describe, expect, it } from 'vitest'
import { sortProjectsStarredFirst } from './projects'

const projects = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta', isStarred: true },
  { id: 'c', name: 'Gamma' },
  { id: 'd', name: 'Delta', isStarred: true },
]

describe('sortProjectsStarredFirst', () => {
  it('orders starred projects first, then the rest, alphabetical within each group', () => {
    expect(sortProjectsStarredFirst(projects).map((p) => p.name)).toEqual(['Beta', 'Delta', 'Alpha', 'Gamma'])
  })

  it('does not mutate the input array', () => {
    const input = [...projects]
    sortProjectsStarredFirst(input)
    expect(input.map((p) => p.name)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta'])
  })
})
