import { getAllSettings, setSetting } from '../db/settings.js'
import type {
  PluginSettingsField,
  PluginSettingsSchema,
  PluginSettingsValues,
  PluginSettingScope,
  PluginSettingValue,
} from '../../shared/plugin.js'

export interface PluginSettingsView {
  values: PluginSettingsValues
  secretsSet: string[]
}

export function pluginSettingKey(
  pluginId: string,
  scope: PluginSettingScope,
  projectId: string | undefined,
  key: string,
): string {
  const scopeSegment = scope === 'project' && projectId ? `project.${projectId}` : 'global'
  return `plugin.${pluginId}.${scopeSegment}.${key}`
}

function coerce(field: PluginSettingsField, raw: string | undefined): PluginSettingValue | undefined {
  if (raw === undefined) return field.default
  try {
    const parsed = JSON.parse(raw) as unknown
    if (field.type === 'boolean') return typeof parsed === 'boolean' ? parsed : field.default
    if (field.type === 'number') return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : field.default
    return typeof parsed === 'string' ? parsed : field.default
  } catch {
    return field.default
  }
}

export function readPluginSettings(
  pluginId: string,
  schema: PluginSettingsSchema,
  scope: PluginSettingScope = 'global',
  projectId?: string,
): PluginSettingsValues {
  const stored = getAllSettings()
  const values: PluginSettingsValues = {}
  for (const field of schema.fields) {
    const raw = stored[pluginSettingKey(pluginId, field.scope ?? scope, projectId, field.key)]
    const value = coerce(field, raw)
    if (value !== undefined) values[field.key] = value
  }
  return values
}

export function readPluginSettingsView(
  pluginId: string,
  schema: PluginSettingsSchema,
  scope: PluginSettingScope = 'global',
  projectId?: string,
): PluginSettingsView {
  const stored = getAllSettings()
  const values: PluginSettingsValues = {}
  const secretsSet: string[] = []
  for (const field of schema.fields) {
    const raw = stored[pluginSettingKey(pluginId, field.scope ?? scope, projectId, field.key)]
    if (isSecret(field)) {
      if (raw !== undefined && raw !== '') secretsSet.push(field.key)
      continue
    }
    const value = coerce(field, raw)
    if (value !== undefined) values[field.key] = value
  }
  return { values, secretsSet }
}

export function isSecret(field: PluginSettingsField): boolean {
  return field.secret === true || field.type === 'password'
}

export function validatePluginSettings(schema: PluginSettingsSchema, values: Record<string, unknown>): string[] {
  const errors: string[] = []
  for (const field of schema.fields) {
    if (!(field.key in values)) {
      if (field.required) errors.push(`Missing required setting '${field.key}'`)
      continue
    }
    const value = values[field.key]
    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') errors.push(`Setting '${field.key}' must be a boolean`)
    } else if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`Setting '${field.key}' must be a number`)
    } else if (field.type === 'select') {
      if (typeof value !== 'string' || !(field.options ?? []).some((option) => option.value === value)) {
        errors.push(`Setting '${field.key}' must be one of the declared options`)
      }
    } else if (typeof value !== 'string') {
      errors.push(`Setting '${field.key}' must be a string`)
    }
  }
  return errors
}

export function writePluginSettings(
  pluginId: string,
  schema: PluginSettingsSchema,
  incoming: Record<string, unknown>,
  scope: PluginSettingScope = 'global',
  projectId?: string,
): { errors: string[] } {
  const errors = validatePluginSettings(schema, incoming)
  if (errors.length > 0) return { errors }

  for (const field of schema.fields) {
    if (!(field.key in incoming)) continue
    const value = incoming[field.key]
    if (isSecret(field) && (value === '' || value === null || value === undefined)) continue
    setSetting(pluginSettingKey(pluginId, field.scope ?? scope, projectId, field.key), JSON.stringify(value))
  }
  return { errors: [] }
}
