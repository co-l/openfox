import { getAllSettings, setSetting } from '../db/settings.js'
import type {
  PluginSettingsField,
  PluginSettingsSchema,
  PluginSettingsValues,
  PluginSettingScope,
  PluginSettingValue,
} from '../../shared/plugin.js'

export const MASKED_SECRET = '••••••••••••••••'

export function isMaskedValue(value: unknown): boolean {
  return typeof value === 'string' && (value === MASKED_SECRET || /^[•*]+$/.test(value))
}

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

/** Key of a value a plugin keeps in its own storage (`context.storage`). */
export function pluginStorageKey(pluginId: string, key: string): string {
  return `plugin.${pluginId}.storage.${key}`
}

/** Row a field is backed by: the plugin's storage when it declares `storageKey`. */
function fieldStorageRow(
  stored: Record<string, string>,
  pluginId: string,
  field: PluginSettingsField,
  scope: PluginSettingScope,
  projectId: string | undefined,
): string | undefined {
  return field.storageKey
    ? stored[pluginStorageKey(pluginId, field.storageKey)]
    : stored[pluginSettingKey(pluginId, field.scope ?? scope, projectId, field.key)]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSecret(field: PluginSettingsField): boolean {
  return field.secret === true || field.type === 'password'
}

/**
 * A `list` value is stored (and travels) as a JSON array string, so the stored
 * blob is the JSON encoding of that string, exactly like every other setting.
 */
function parseJsonArray(raw: unknown): unknown[] | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function parseListValue(raw: unknown): Record<string, unknown>[] | undefined {
  const parsed = parseJsonArray(raw)
  return parsed ? parsed.filter(isRecord) : undefined
}

function coerce(field: PluginSettingsField, raw: string | undefined): PluginSettingValue | undefined {
  if (raw === undefined) return field.default
  try {
    const parsed = JSON.parse(raw) as unknown
    if (field.type === 'boolean') return typeof parsed === 'boolean' ? parsed : field.default
    if (field.type === 'number') return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : field.default
    if (field.type === 'list') {
      if (Array.isArray(parsed)) return JSON.stringify(parsed)
      if (typeof parsed === 'string') return parseJsonArray(parsed) ? parsed : field.default
      return field.default
    }
    return typeof parsed === 'string' ? parsed : field.default
  } catch {
    return field.default
  }
}

/** Replaces every configured secret sub-value of a list with the mask. */
function maskListSecrets(field: PluginSettingsField, raw: string): string {
  const items = parseListValue(raw)
  if (!items) return raw
  const masked = items.map((item) => {
    const next: Record<string, unknown> = { ...item }
    for (const sub of field.itemFields ?? []) {
      if (!isSecret(sub)) continue
      const value = next[sub.key]
      if (typeof value === 'string' && value !== '') next[sub.key] = MASKED_SECRET
    }
    return next
  })
  return JSON.stringify(masked)
}

/**
 * Secrets nested in list items are matched by row index: a masked or empty
 * submitted value keeps whatever was stored for that row.
 */
function mergeListSecrets(field: PluginSettingsField, incoming: string, stored: string | undefined): string {
  const incomingItems = parseListValue(incoming)
  if (!incomingItems) return incoming
  const storedItems = stored === undefined ? [] : (parseListValue(stored) ?? [])
  const merged = incomingItems.map((item, index) => {
    const next: Record<string, unknown> = { ...item }
    for (const sub of field.itemFields ?? []) {
      if (!isSecret(sub)) continue
      const value = next[sub.key]
      if (typeof value === 'string' && value !== '' && !isMaskedValue(value)) continue
      const previous = storedItems[index]?.[sub.key]
      if (typeof previous === 'string' && previous !== '') next[sub.key] = previous
      else delete next[sub.key]
    }
    return next
  })
  return JSON.stringify(merged)
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
    if (field.type === 'button' || field.type === 'status') continue
    const raw = fieldStorageRow(stored, pluginId, field, scope, projectId)
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
    if (field.type === 'button' || field.type === 'status' || field.readOnly) continue
    const raw = fieldStorageRow(stored, pluginId, field, scope, projectId)
    if (isSecret(field)) {
      if (raw !== undefined && raw !== '') secretsSet.push(field.key)
      continue
    }
    const value = coerce(field, raw)
    if (value === undefined) continue
    values[field.key] = field.type === 'list' && typeof value === 'string' ? maskListSecrets(field, value) : value
  }
  return { values, secretsSet }
}

function validateFieldValue(field: PluginSettingsField, value: unknown, path: string, errors: string[]): void {
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') errors.push(`Setting '${path}' must be a boolean`)
  } else if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`Setting '${path}' must be a number`)
  } else if (field.type === 'select') {
    if (typeof value !== 'string' || !(field.options ?? []).some((option) => option.value === value)) {
      errors.push(`Setting '${path}' must be one of the declared options`)
    }
  } else if (field.type === 'list') {
    validateListValue(field, value, path, errors)
  } else if (typeof value !== 'string') {
    errors.push(`Setting '${path}' must be a string`)
  }
}

function validateListValue(field: PluginSettingsField, value: unknown, path: string, errors: string[]): void {
  const items = parseJsonArray(value)
  if (!items) {
    errors.push(`Setting '${path}' must be a JSON array string`)
    return
  }
  if (field.minItems !== undefined && items.length < field.minItems) {
    errors.push(`Setting '${path}' needs at least ${field.minItems} item${field.minItems === 1 ? '' : 's'}`)
  }
  if (field.maxItems !== undefined && items.length > field.maxItems) {
    errors.push(`Setting '${path}' accepts at most ${field.maxItems} item${field.maxItems === 1 ? '' : 's'}`)
  }
  items.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`Setting '${path}[${index}]' must be an object`)
      return
    }
    for (const sub of field.itemFields ?? []) {
      const subPath = `${path}[${index}].${sub.key}`
      const subValue = item[sub.key]
      if (subValue === undefined || subValue === null || subValue === '') {
        if (isSecret(sub)) continue
        if (sub.required) errors.push(`Missing required setting '${subPath}'`)
        continue
      }
      if (isSecret(sub) && isMaskedValue(subValue)) continue
      validateFieldValue(sub, subValue, subPath, errors)
    }
  })
}

export function validatePluginSettings(
  schema: PluginSettingsSchema,
  values: Record<string, unknown>,
  isExistingSecret?: (key: string) => boolean,
): string[] {
  const errors: string[] = []
  for (const field of schema.fields) {
    if (field.type === 'button' || field.type === 'status' || field.readOnly) continue
    if (!(field.key in values)) {
      if (field.required) {
        if (isSecret(field) && isExistingSecret && isExistingSecret(field.key)) {
          continue
        }
        errors.push(`Missing required setting '${field.key}'`)
      }
      continue
    }
    const value = values[field.key]
    if (isSecret(field) && (isMaskedValue(value) || value === '' || value === undefined)) {
      if (
        field.required &&
        !(isExistingSecret && isExistingSecret(field.key)) &&
        (value === '' || value === undefined)
      ) {
        errors.push(`Missing required setting '${field.key}'`)
      }
      continue
    }
    validateFieldValue(field, value, field.key, errors)
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
  const stored = getAllSettings()
  const isExistingSecret = (key: string) => {
    const field = schema.fields.find((f) => f.key === key)
    const raw = field
      ? fieldStorageRow(stored, pluginId, field, scope, projectId)
      : stored[pluginSettingKey(pluginId, scope, projectId, key)]
    return raw !== undefined && raw !== ''
  }
  const errors = validatePluginSettings(schema, incoming, isExistingSecret)
  if (errors.length > 0) return { errors }
  for (const field of schema.fields) {
    if (field.readOnly) continue
    if (!(field.key in incoming)) continue
    const value = incoming[field.key]
    if (isSecret(field) && (value === '' || value === null || value === undefined || isMaskedValue(value))) {
      continue
    }
    const key = field.storageKey
      ? pluginStorageKey(pluginId, field.storageKey)
      : pluginSettingKey(pluginId, field.scope ?? scope, projectId, field.key)
    const next =
      field.type === 'list' && typeof value === 'string'
        ? mergeListSecrets(field, value, coerce(field, stored[key]) as string | undefined)
        : value
    setSetting(key, JSON.stringify(next))
  }
  return { errors: [] }
}
