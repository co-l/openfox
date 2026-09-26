import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initDatabase } from '../db/index.js'
import { loadConfig } from '../config.js'
import { getAllSettings, setSetting } from '../db/settings.js'
import {
  MASKED_SECRET,
  pluginSettingKey,
  pluginStorageKey,
  readPluginSettings,
  readPluginSettingsView,
  validatePluginSettings,
  writePluginSettings,
} from './settings.js'
import type { PluginSettingsSchema } from '../../shared/plugin.js'

const schema: PluginSettingsSchema = {
  fields: [
    {
      key: 'registries',
      type: 'list',
      label: { en: 'Registries', fr: 'Registres' },
      default: '[]',
      itemFields: [
        {
          key: 'source',
          type: 'select',
          label: { en: 'Source', fr: 'Source' },
          options: [
            { value: 'github', label: { en: 'GitHub', fr: 'GitHub' } },
            { value: 'gitlab', label: { en: 'GitLab', fr: 'GitLab' } },
          ],
        },
        { key: 'url', type: 'text', label: { en: 'Registry URL', fr: 'URL du registre' } },
        { key: 'token', type: 'password', secret: true, label: { en: 'Token', fr: 'Jeton' } },
      ],
    },
  ],
}

function storeList(pluginId: string, items: Array<Record<string, unknown>>): void {
  setSetting(pluginSettingKey(pluginId, 'global', undefined, 'registries'), JSON.stringify(JSON.stringify(items)))
}

describe('plugin settings list fields', () => {
  beforeEach(() => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
  })

  afterEach(() => {
    closeDatabase()
  })

  it('falls back to the default when the stored list is not a JSON array', () => {
    const broken: PluginSettingsSchema = {
      fields: [{ ...schema.fields[0]!, default: '[]' }],
    }
    setSetting(pluginSettingKey('demo', 'global', undefined, 'registries'), JSON.stringify('{not-json'))

    expect(readPluginSettings('demo', broken)['registries']).toBe('[]')

    setSetting(pluginSettingKey('demo', 'global', undefined, 'registries'), JSON.stringify('{"a":1}'))
    expect(readPluginSettings('demo', broken)['registries']).toBe('[]')
  })

  it('reads a list as a JSON array string, unmasked at runtime and masked in the settings view', () => {
    storeList('demo', [{ source: 'github', url: 'https://github.test/index.json', token: 'ghp_secret' }])

    expect(readPluginSettings('demo', schema)['registries']).toBe(
      JSON.stringify([{ source: 'github', url: 'https://github.test/index.json', token: 'ghp_secret' }]),
    )

    const view = readPluginSettingsView('demo', schema)
    expect(view.secretsSet).toEqual([])
    expect(JSON.parse(String(view.values['registries']))).toEqual([
      { source: 'github', url: 'https://github.test/index.json', token: MASKED_SECRET },
    ])
  })

  it('keeps the stored token of a row when the submitted one is masked or empty', () => {
    storeList('demo', [
      { source: 'github', url: 'https://github.test/index.json', token: 'ghp_secret' },
      { source: 'gitlab', url: 'https://gitlab.test/index.json', token: 'glpat_secret' },
    ])

    const incoming = [
      { source: 'github', url: 'https://github.test/index.json', token: MASKED_SECRET },
      { source: 'gitlab', url: 'https://gitlab.test/other.json', token: '' },
    ]
    const result = writePluginSettings('demo', schema, { registries: JSON.stringify(incoming) })
    expect(result.errors).toEqual([])

    expect(JSON.parse(String(readPluginSettings('demo', schema)['registries']))).toEqual([
      { source: 'github', url: 'https://github.test/index.json', token: 'ghp_secret' },
      { source: 'gitlab', url: 'https://gitlab.test/other.json', token: 'glpat_secret' },
    ])
  })

  it('stores a newly typed token and drops the one of a removed row', () => {
    storeList('demo', [
      { source: 'github', url: 'https://github.test/index.json', token: 'ghp_secret' },
      { source: 'gitlab', url: 'https://gitlab.test/index.json', token: 'glpat_secret' },
    ])

    writePluginSettings('demo', schema, {
      registries: JSON.stringify([{ source: 'gitlab', url: 'https://gitlab.test/index.json', token: 'glpat_new' }]),
    })

    expect(JSON.parse(String(readPluginSettings('demo', schema)['registries']))).toEqual([
      { source: 'gitlab', url: 'https://gitlab.test/index.json', token: 'glpat_new' },
    ])
  })

  it('validates item shape, select options, item types and row bounds', () => {
    const bounded: PluginSettingsSchema = {
      fields: [{ ...schema.fields[0]!, minItems: 1, maxItems: 2 }],
    }

    expect(validatePluginSettings(schema, { registries: 'not-json' })).toEqual([
      "Setting 'registries' must be a JSON array string",
    ])
    expect(validatePluginSettings(schema, { registries: '{"a":1}' })).toEqual([
      "Setting 'registries' must be a JSON array string",
    ])
    expect(validatePluginSettings(schema, { registries: '[1]' })).toEqual(["Setting 'registries[0]' must be an object"])
    expect(validatePluginSettings(schema, { registries: '[{"source":"bitbucket","url":"u"}]' })).toEqual([
      "Setting 'registries[0].source' must be one of the declared options",
    ])
    expect(validatePluginSettings(schema, { registries: '[{"source":"github","url":42}]' })).toEqual([
      "Setting 'registries[0].url' must be a string",
    ])
    expect(validatePluginSettings(bounded, { registries: '[]' })).toEqual([
      "Setting 'registries' needs at least 1 item",
    ])
    expect(
      validatePluginSettings(bounded, {
        registries: '[{"source":"github","url":"a"},{"source":"github","url":"b"},{"source":"github","url":"c"}]',
      }),
    ).toEqual(["Setting 'registries' accepts at most 2 items"])
    expect(validatePluginSettings(schema, { registries: '[{"source":"github","url":"a","token":"x"}]' })).toEqual([])
  })
})

const storageSchema: PluginSettingsSchema = {
  fields: [
    { key: 'endpoint', type: 'text', label: { en: 'Endpoint', fr: 'Endpoint' }, default: 'https://api.test' },
    {
      key: 'token',
      type: 'password',
      secret: true,
      storageKey: 'legacy_token',
      label: { en: 'Token', fr: 'Jeton' },
    },
  ],
}

describe('plugin settings backed by the plugin storage', () => {
  beforeEach(() => {
    closeDatabase()
    const config = loadConfig()
    config.database.path = ':memory:'
    initDatabase(config)
  })

  afterEach(() => {
    closeDatabase()
  })

  it('reports a token kept in the plugin storage as set, without ever returning it', () => {
    setSetting(pluginStorageKey('demo', 'legacy_token'), JSON.stringify('ghp_legacy'))

    const view = readPluginSettingsView('demo', storageSchema)
    expect(view.secretsSet).toEqual(['token'])
    expect(view.values['token']).toBeUndefined()
    expect(JSON.stringify(view)).not.toContain('ghp_legacy')
  })

  it('reads the stored value at runtime, with the same "set" rule as a settings-backed secret', () => {
    expect(readPluginSettings('demo', storageSchema)['token']).toBeUndefined()
    expect(readPluginSettingsView('demo', storageSchema).secretsSet).toEqual([])

    setSetting(pluginStorageKey('demo', 'legacy_token'), JSON.stringify('ghp_legacy'))
    expect(readPluginSettings('demo', storageSchema)['token']).toBe('ghp_legacy')

    // The row still exists, so it counts as set — exactly like the settings store.
    setSetting(pluginStorageKey('demo', 'legacy_token'), JSON.stringify(''))
    expect(readPluginSettings('demo', storageSchema)['token']).toBe('')
    expect(readPluginSettingsView('demo', storageSchema).secretsSet).toEqual(['token'])
  })

  it('writes a submitted value to the plugin storage row, not to the settings row', () => {
    const result = writePluginSettings('demo', storageSchema, { token: 'ghp_new' })
    expect(result.errors).toEqual([])

    expect(readPluginSettings('demo', storageSchema)['token']).toBe('ghp_new')
    expect(getAllSettings()[pluginSettingKey('demo', 'global', undefined, 'token')]).toBeUndefined()
    expect(readPluginSettingsView('demo', storageSchema).secretsSet).toEqual(['token'])
  })

  it('keeps the stored token when the submitted one is masked or empty', () => {
    setSetting(pluginStorageKey('demo', 'legacy_token'), JSON.stringify('ghp_legacy'))

    writePluginSettings('demo', storageSchema, { token: MASKED_SECRET })
    expect(readPluginSettings('demo', storageSchema)['token']).toBe('ghp_legacy')

    writePluginSettings('demo', storageSchema, { token: '' })
    expect(readPluginSettings('demo', storageSchema)['token']).toBe('ghp_legacy')
  })
})
