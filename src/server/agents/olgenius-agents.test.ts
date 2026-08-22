import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadUserAgents } from './registry.js'

/** Read a fixture shipped as raw markdown source. */
const fixture = (name: string): string => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'olgenius-agents-'))
  await mkdir(join(dir, 'agents'), { recursive: true })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const AGENT_FILES = [
  'orchestrator.agent.md',
  'planificateur.agent.md',
  'avocat-du-diable.agent.md',
  'dev-tdd.agent.md',
  'qa.agent.md',
]

describe('olgenius agents — fixtures load as top-level agents', () => {
  it('loads exactly the 5 olgenius agents with expected ids', async () => {
    for (const name of AGENT_FILES) {
      await writeFile(join(dir, 'agents', name), fixture(name))
    }
    const agents = await loadUserAgents(dir)
    const ids = agents.map((a) => a.metadata.id).sort()
    expect(ids).toEqual(['avocat-du-diable', 'dev-tdd', 'orchestrator', 'planificateur', 'qa'])
  })

  it('all 5 are top-level (subagent === false)', async () => {
    for (const name of AGENT_FILES) {
      await writeFile(join(dir, 'agents', name), fixture(name))
    }
    const agents = await loadUserAgents(dir)
    for (const a of agents) {
      expect(a.metadata.subagent, `${a.metadata.id} should be top-level`).toBe(false)
    }
  })

  it('each agent declares its role-specific allowedTools', async () => {
    for (const name of AGENT_FILES) {
      await writeFile(join(dir, 'agents', name), fixture(name))
    }
    const agents = await loadUserAgents(dir)
    const tools = (id: string): string[] => agents.find((a) => a.metadata.id === id)!.metadata.allowedTools

    // orchestrator: talks to user + routes via metadata, writes artifacts
    expect(tools('orchestrator')).toContain('ask_user')
    expect(tools('orchestrator')).toContain('session_metadata')
    expect(tools('orchestrator')).toContain('write_file')

    // planificateur: writes PLAN, no user interaction
    expect(tools('planificateur')).toContain('write_file')
    expect(tools('planificateur')).not.toContain('ask_user')

    // avocat-du-diable: writes OBJECTIONS, no code edit
    expect(tools('avocat-du-diable')).toContain('write_file')
    expect(tools('avocat-du-diable')).not.toContain('edit_file')

    // dev-tdd: the ONLY one editing source code
    expect(tools('dev-tdd')).toContain('edit_file')
    expect(tools('dev-tdd')).toContain('write_file')

    // qa: never corrects — no edit_file
    expect(tools('qa')).not.toContain('edit_file')
    expect(tools('qa')).toContain('run_command')
  })

  it('only dev-tdd may edit_file (separation of concerns)', async () => {
    for (const name of AGENT_FILES) {
      await writeFile(join(dir, 'agents', name), fixture(name))
    }
    const agents = await loadUserAgents(dir)
    const editors = agents.filter((a) => a.metadata.allowedTools.includes('edit_file')).map((a) => a.metadata.id)
    expect(editors).toEqual(['dev-tdd'])
  })

  it('each agent has a non-empty body prompt (the role instructions)', async () => {
    for (const name of AGENT_FILES) {
      await writeFile(join(dir, 'agents', name), fixture(name))
    }
    const agents = await loadUserAgents(dir)
    for (const a of agents) {
      expect(a.prompt.length, `${a.metadata.id} prompt empty`).toBeGreaterThan(100)
    }
  })
})
