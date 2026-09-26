import { Fragment, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useResource } from '../../hooks/useResource'
import { useT } from '../../hooks/useT'
import { useLocalizedString } from '../../hooks/useLocalizedString'
import { pluginSettingsResource, providersResource } from '../../lib/resources'
import { invokePluginRpc, savePluginSettings } from '../../lib/plugin-actions'
import { Button } from '../shared/Button'
import { Toggle } from '../shared/Toggle'
import { PlusIcon, TrashIcon, OpenExternalIcon, FolderIcon } from '../shared/icons'
import { DirectoryBrowser } from '../shared/DirectoryBrowser'
import type {
  LocalizedString,
  PluginBadgeTone,
  PluginSettingsField,
  PluginSettingsLinkButton,
  PluginSettingScope,
  PluginSettingValue,
} from '@shared/plugin.js'

type FormValues = Record<string, PluginSettingValue | string>

interface StatusFieldState {
  loading?: boolean
  running?: boolean
  installed?: boolean
  text?: string | LocalizedString
  tone?: PluginBadgeTone
}

const FIELD_CLASS = 'w-full px-2.5 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded'
const MASKED_SECRET = '••••••••••••••••'

const STATUS_TONE_DOT: Record<PluginBadgeTone, string> = {
  success: 'bg-accent-success',
  warning: 'bg-accent-warning',
  danger: 'bg-accent-error',
  info: 'bg-accent-primary',
  neutral: 'bg-text-muted',
}

function isSecretField(field: PluginSettingsField): boolean {
  return field.secret === true || field.type === 'password'
}

function isMaskedValue(value: unknown): boolean {
  return typeof value === 'string' && (value === MASKED_SECRET || /^[•*]+$/.test(value))
}

function parseListItems(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item),
    )
  } catch {
    return []
  }
}

const HREF_PLACEHOLDER = /\{\{\s*([\w.-]+?)\s*\}\}/g

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Resolves a `linkButton` template against a row's values (falling back to the
 * whole form). Returns `''` when the template has no usable target, which
 * renders the button disabled.
 */
export function resolveLinkButtonHref(linkButton: PluginSettingsLinkButton, values: Record<string, unknown>): string {
  const selected = linkButton.hrefByField ? String(values[linkButton.hrefByField] ?? '') : ''
  const template = (linkButton.hrefByValue ?? {})[selected] ?? linkButton.href ?? ''
  if (!template) return ''

  return template.replace(HREF_PLACEHOLDER, (_match, placeholder: string) => {
    const [key, accessor] = placeholder.split('.')
    const raw = values[key ?? '']
    const value = raw === undefined || raw === null ? '' : String(raw)
    if (accessor === 'origin') {
      try {
        return new URL(value).origin
      } catch {
        return ''
      }
    }
    return value
  })
}

function LinkButton({
  linkButton,
  values,
  disabled,
}: {
  linkButton: PluginSettingsLinkButton
  values: Record<string, unknown>
  disabled: boolean
}) {
  const localize = useLocalizedString()
  const label = localize(linkButton.label)
  const href = resolveLinkButtonHref(linkButton, values)

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || !isHttpUrl(href)}
      onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
      className="shrink-0 rounded p-1.5 text-text-muted hover:text-accent-primary disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <OpenExternalIcon />
    </button>
  )
}

function newListItem(field: PluginSettingsField): Record<string, unknown> {
  const item: Record<string, unknown> = {}
  for (const sub of field.itemFields ?? []) {
    if (sub.type === 'boolean') item[sub.key] = sub.default === true
    else if (sub.type === 'number') item[sub.key] = typeof sub.default === 'number' ? sub.default : ''
    else item[sub.key] = typeof sub.default === 'string' ? sub.default : (sub.options?.[0]?.value ?? '')
  }
  return item
}

function ListFieldInput({
  field,
  value,
  formValues,
  disabled,
  onChange,
}: {
  field: PluginSettingsField
  value: string
  formValues: Record<string, unknown>
  disabled: boolean
  onChange: (value: string) => void
}) {
  const t = useT()
  const localize = useLocalizedString()
  const items = parseListItems(value)
  const subFields = field.itemFields ?? []
  const addLabel = field.addLabel ? localize(field.addLabel) : t({ en: 'Add', fr: 'Ajouter' })
  const removeLabel = field.removeLabel ? localize(field.removeLabel) : t({ en: 'Remove', fr: 'Supprimer' })
  const atMax = field.maxItems !== undefined && items.length >= field.maxItems

  const commit = (next: Array<Record<string, unknown>>) => onChange(JSON.stringify(next))
  const updateItem = (index: number, key: string, next: unknown) =>
    commit(items.map((item, position) => (position === index ? { ...item, [key]: next } : item)))

  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div key={`${field.key}-${index}`} className="flex items-end gap-2">
          {subFields.map((sub) => {
            const id = `plugin-setting-${field.key}-${index}-${sub.key}`
            const subValue = item[sub.key]
            return (
              <div
                key={sub.key}
                className={`flex flex-col gap-1 ${sub.type === 'select' ? 'w-28 shrink-0' : 'flex-1 min-w-0'}`}
              >
                <label className="text-[10px] text-text-muted" htmlFor={id}>
                  {localize(sub.label)}
                </label>
                <div className="flex items-center gap-1">
                  {sub.type === 'select' ? (
                    <select
                      id={id}
                      value={String(subValue ?? '')}
                      disabled={disabled}
                      onChange={(event) => updateItem(index, sub.key, event.target.value)}
                      className={FIELD_CLASS}
                    >
                      {(sub.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {localize(option.label)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={id}
                      type={sub.type === 'password' ? 'password' : sub.type === 'number' ? 'number' : 'text'}
                      value={String(subValue ?? '')}
                      disabled={disabled}
                      {...(sub.placeholder ? { placeholder: sub.placeholder } : {})}
                      onFocus={(event) => {
                        if (isMaskedValue(subValue)) event.target.select()
                      }}
                      onChange={(event) => {
                        const next = event.target.value
                        if (isMaskedValue(subValue) && next.startsWith(String(subValue))) {
                          updateItem(index, sub.key, next.slice(String(subValue).length))
                        } else if (sub.type === 'number') {
                          updateItem(index, sub.key, next === '' ? '' : Number(next))
                        } else {
                          updateItem(index, sub.key, next)
                        }
                      }}
                      className={FIELD_CLASS}
                    />
                  )}
                  {sub.linkButton ? (
                    <LinkButton linkButton={sub.linkButton} values={{ ...formValues, ...item }} disabled={disabled} />
                  ) : null}
                </div>
              </div>
            )
          })}
          <button
            type="button"
            aria-label={removeLabel}
            title={removeLabel}
            disabled={disabled}
            onClick={() => commit(items.filter((_, position) => position !== index))}
            className="mb-0.5 rounded p-1.5 text-text-muted hover:text-accent-error hover:bg-bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || atMax}
          onClick={() => commit([...items, newListItem(field)])}
        >
          <span className="inline-flex items-center gap-1">
            <PlusIcon className="w-3 h-3" />
            {addLabel}
          </span>
        </Button>
      </div>
    </div>
  )
}

function FieldInput({
  id,
  value,
  onChange,
  multiline,
  type,
  placeholder,
  disabled,
}: {
  id: string
  value: string | number
  onChange: (value: string) => void
  multiline?: boolean
  type?: string
  placeholder?: string
  disabled?: boolean
}) {
  const strVal = String(value ?? '')
  if (multiline) {
    return (
      <textarea
        id={id}
        value={strVal}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        disabled={disabled}
        className={FIELD_CLASS}
      />
    )
  }
  return (
    <input
      id={id}
      type={type ?? 'text'}
      value={strVal}
      placeholder={placeholder ?? ''}
      disabled={disabled}
      onFocus={(event) => {
        if (strVal === MASKED_SECRET) {
          event.target.select()
        }
      }}
      onChange={(event) => {
        const next = event.target.value
        if (strVal === MASKED_SECRET && next.startsWith(MASKED_SECRET)) {
          onChange(next.slice(MASKED_SECRET.length))
        } else {
          onChange(next)
        }
      }}
      className={FIELD_CLASS}
    />
  )
}

function initialValue(
  field: PluginSettingsField,
  values: Record<string, unknown>,
  secretsSet: string[],
): FormValues[string] {
  if (field.type === 'button' || field.type === 'status') {
    return ''
  }
  if (field.readOnly) {
    return (field.default as string) ?? ''
  }
  if (isSecretField(field) && secretsSet.includes(field.key)) {
    return MASKED_SECRET
  }
  const stored = values[field.key]
  if (field.type === 'boolean') return typeof stored === 'boolean' ? stored : ((field.default as boolean) ?? false)
  if (field.type === 'number') return typeof stored === 'number' ? stored : ((field.default as number) ?? '')
  if (field.type === 'list') {
    if (typeof stored === 'string') return stored
    return typeof field.default === 'string' ? field.default : '[]'
  }
  if (typeof stored === 'string') return stored
  return (field.default as string) ?? ''
}

export function PluginSettingsForm({
  pluginId,
  scope: initialScope = 'global',
  projectId,
  dangerLevel,
  hideScopeSelector = false,
}: {
  pluginId: string
  scope?: PluginSettingScope
  projectId?: string
  dangerLevel?: string
  hideScopeSelector?: boolean
}) {
  const t = useT()
  const localize = useLocalizedString()
  const [scope, setScope] = useState<PluginSettingScope>(initialScope)
  const { data } = useResource(pluginSettingsResource, pluginId, scope, projectId)
  const [values, setValues] = useState<FormValues>({})
  const [statusStates, setStatusStates] = useState<Record<string, StatusFieldState>>({})
  const [browsingField, setBrowsingField] = useState<PluginSettingsField | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const refreshStatuses = useCallback(async () => {
    if (!data) return
    const statusFields = data.schema.fields.filter((f) => f.type === 'status')
    if (statusFields.length === 0) return

    for (const field of statusFields) {
      try {
        const res = (await invokePluginRpc(pluginId, field.rpcMethod ?? field.key, {})) as Record<string, unknown>
        const installed = res?.['installed'] === true || res?.['running'] === true
        setStatusStates((prev) => ({
          ...prev,
          [field.key]: {
            installed,
            running: typeof res?.['running'] === 'boolean' ? res['running'] : undefined,
            text:
              (res?.['statusText'] as string | undefined) ??
              (res?.['text'] as string | LocalizedString | undefined) ??
              (res?.['message'] as string | undefined),
            tone:
              (res?.['statusTone'] as PluginBadgeTone | undefined) ??
              (res?.['tone'] as PluginBadgeTone | undefined) ??
              (installed ? 'success' : 'danger'),
            loading: false,
          },
        }))
      } catch {
        setStatusStates((prev) => ({
          ...prev,
          [field.key]: { tone: 'danger', loading: false },
        }))
      }
    }
  }, [data, pluginId])

  useEffect(() => {
    if (!data) return
    const next: FormValues = {}
    for (const field of data.schema.fields) next[field.key] = initialValue(field, data.values, data.secretsSet)
    setValues(next)
    void refreshStatuses()
  }, [data, refreshStatuses])

  if (!data) {
    return <p className="text-sm text-text-muted">{t({ en: 'Loading settings…', fr: 'Chargement des paramètres…' })}</p>
  }

  const projectScoped = projectId !== undefined && data.schema.fields.some((field) => field.scope === 'project')

  const saveValues = async (nextValues: FormValues) => {
    const payload: Record<string, unknown> = {}
    for (const field of data.schema.fields) {
      if (field.type === 'button' || field.type === 'status' || field.readOnly) continue
      const value = nextValues[field.key]
      if (isSecretField(field) && (isMaskedValue(value) || value === '' || value === undefined)) continue
      if (field.type === 'number' && value === '') continue
      payload[field.key] = value
    }
    const result = await savePluginSettings(pluginId, payload, scope, projectId)
    if (!result.ok) {
      setError(result.error ?? t({ en: 'Failed to save settings', fr: 'Échec de l’enregistrement des paramètres' }))
      return
    }
    // A freshly typed secret is not echoed back by the server: mark it as set so
    // the input switches to the mask instead of looking empty.
    const secretsSet = new Set(data.secretsSet)
    for (const field of data.schema.fields) {
      const written = payload[field.key]
      if (isSecretField(field) && typeof written === 'string' && written !== '') secretsSet.add(field.key)
    }
    pluginSettingsResource.write(
      {
        schema: data.schema,
        values: payload as Record<string, string | number | boolean>,
        secretsSet: [...secretsSet],
      },
      pluginId,
      scope,
      projectId,
    )
    void providersResource.refresh()
    setError(null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-4">
      {!hideScopeSelector && projectScoped ? (
        <div>
          <label className="block text-xs text-text-secondary mb-1" htmlFor="plugin-setting-scope">
            {t({ en: 'Applies to', fr: 'S’applique à' })}
          </label>
          <select
            id="plugin-setting-scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as PluginSettingScope)}
            className={FIELD_CLASS}
          >
            <option value="global">{t({ en: 'All projects', fr: 'Tous les projets' })}</option>
            <option value="project">{t({ en: 'This project', fr: 'Ce projet' })}</option>
          </select>
        </div>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {data.schema.fields.map((field, index) => {
          if (field.dangerLevels && dangerLevel && !field.dangerLevels.includes(dangerLevel)) {
            return null
          }
          const isAnyInstalled = Object.values(statusStates).some((s) => s.installed === true)
          if (field.hideWhenInstalled && isAnyInstalled) {
            return null
          }

          const label = localize(field.label)
          const description = field.description ? localize(field.description) : undefined
          const value = values[field.key]
          const parentEnabled = field.parentKey ? values[field.parentKey] === true : true
          const previousField = index > 0 ? data.schema.fields[index - 1] : undefined
          const previousParentKey = previousField?.parentKey
          const startsGroup = Boolean(field.parentKey && field.parentKey !== previousParentKey)
          const nextParentKey =
            index < data.schema.fields.length - 1 ? data.schema.fields[index + 1]?.parentKey : undefined
          const endsGroup = Boolean(field.parentKey && field.parentKey !== nextParentKey)
          const isHalf = field.width === 'half'
          const showSectionHeader =
            field.section !== undefined &&
            (previousField === undefined ||
              previousField.section === undefined ||
              localize(field.section) !== localize(previousField.section))

          const linkButton = field.linkButton
          const withLinkButton = (node: ReactNode) =>
            linkButton ? (
              <div className="flex items-center gap-1">
                <div className="flex-1 min-w-0">{node}</div>
                <LinkButton linkButton={linkButton} values={values} disabled={field.readOnly === true} />
              </div>
            ) : (
              node
            )

          return (
            <Fragment key={field.key}>
              {showSectionHeader ? (
                <div className="col-span-1 sm:col-span-2 pt-3 pb-1 border-b border-border/50">
                  <span className="text-xs font-semibold text-text-primary uppercase tracking-wide">
                    {localize(field.section!)}
                  </span>
                </div>
              ) : null}
              <div
                className={`${isHalf ? 'col-span-1' : 'col-span-1 sm:col-span-2'} ${field.parentKey ? `ml-3 pl-4 border-l-2 border-border/60 ${startsGroup ? 'pt-1' : ''} ${endsGroup ? 'pb-1' : ''}` : ''} ${!parentEnabled ? 'opacity-45' : ''}`}
              >
                <div className="flex items-center justify-between mb-1 gap-2">
                  <label className="block text-xs text-text-secondary" htmlFor={`plugin-setting-${field.key}`}>
                    {label}
                  </label>
                  {field.browseDirectory || field.type === 'path' ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setBrowsingField(field)}
                      disabled={field.readOnly === true || !parentEnabled}
                      className="text-xs py-0.5 px-2 h-6 flex items-center shrink-0"
                    >
                      <FolderIcon className="w-3.5 h-3.5 mr-1 text-text-muted" />
                      {field.browseButtonLabel
                        ? localize(field.browseButtonLabel)
                        : t({ en: 'Browse folder…', fr: 'Parcourir…' })}
                    </Button>
                  ) : null}
                </div>
                {field.type === 'boolean' ? (
                  <Toggle
                    enabled={value === true}
                    onClick={() => {
                      if (!parentEnabled) return
                      const next = { ...values, [field.key]: !(values[field.key] === true) }
                      setValues(next)
                      void saveValues(next)
                    }}
                  />
                ) : field.type === 'status' ? (
                  <div className="flex items-center gap-2 py-1">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${
                        STATUS_TONE_DOT[
                          statusStates[field.key]?.tone ?? (statusStates[field.key]?.running ? 'success' : 'danger')
                        ]
                      }`}
                    />
                    <span className="text-sm font-medium text-text-primary">
                      {statusStates[field.key]?.loading
                        ? t({ en: 'Checking…', fr: 'Vérification…' })
                        : statusStates[field.key]?.text
                          ? typeof statusStates[field.key]!.text === 'object'
                            ? localize(statusStates[field.key]!.text as LocalizedString)
                            : String(statusStates[field.key]!.text)
                          : statusStates[field.key]?.running
                            ? t({ en: 'Running', fr: 'Actif' })
                            : t({ en: 'Stopped', fr: 'Arrêté' })}
                    </span>
                  </div>
                ) : field.type === 'button' ? (
                  <div className="pt-0.5">
                    <Button
                      variant={
                        field.buttonVariant === 'primary' || field.buttonVariant === 'danger'
                          ? field.buttonVariant
                          : 'secondary'
                      }
                      size="sm"
                      onClick={async () => {
                        setError(null)
                        try {
                          await invokePluginRpc(pluginId, field.rpcMethod ?? field.key, {})
                          await refreshStatuses()
                        } catch (actionError) {
                          setError(
                            actionError instanceof Error
                              ? actionError.message
                              : t({ en: 'Action failed', fr: 'Échec de l’action' }),
                          )
                        }
                      }}
                    >
                      {localize(field.buttonLabel ?? field.label)}
                    </Button>
                  </div>
                ) : field.type === 'select' ? (
                  withLinkButton(
                    <select
                      id={`plugin-setting-${field.key}`}
                      value={String(value ?? '')}
                      onChange={(event) => setValues((state) => ({ ...state, [field.key]: event.target.value }))}
                      className={FIELD_CLASS}
                    >
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {localize(option.label)}
                        </option>
                      ))}
                    </select>,
                  )
                ) : field.type === 'list' ? (
                  <ListFieldInput
                    field={field}
                    value={String(value ?? '[]')}
                    formValues={values}
                    disabled={field.readOnly === true}
                    onChange={(next) => setValues((state) => ({ ...state, [field.key]: next }))}
                  />
                ) : field.type === 'textarea' ? (
                  <FieldInput
                    id={`plugin-setting-${field.key}`}
                    value={String(value ?? '')}
                    onChange={(next) => setValues((state) => ({ ...state, [field.key]: next }))}
                    multiline
                    disabled={field.readOnly === true}
                  />
                ) : (
                  withLinkButton(
                    <FieldInput
                      id={`plugin-setting-${field.key}`}
                      value={String(value ?? '')}
                      onChange={(next) =>
                        setValues((state) => ({
                          ...state,
                          [field.key]: field.type === 'number' ? (next === '' ? '' : Number(next)) : next,
                        }))
                      }
                      type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                      disabled={field.readOnly === true}
                      {...(field.placeholder ? { placeholder: field.placeholder } : {})}
                    />,
                  )
                )}
                {description ? <p className="mt-1 text-xs text-text-muted">{description}</p> : null}
              </div>
            </Fragment>
          )
        })}
      </div>
      {error ? <p className="text-xs text-accent-error">{error}</p> : null}
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => void saveValues(values)}>
          {saved ? t({ en: 'Saved', fr: 'Enregistré' }) : t({ en: 'Save', fr: 'Enregistrer' })}
        </Button>
      </div>
      {browsingField ? (
        <DirectoryBrowser
          onSelect={(selectedPath) => {
            if (browsingField.type === 'textarea') {
              setValues((state) => {
                const current = String(state[browsingField.key] ?? '').trim()
                const lines = current ? current.split('\n').map((l) => l.trim()) : []
                if (!lines.includes(selectedPath)) {
                  lines.push(selectedPath)
                }
                return {
                  ...state,
                  [browsingField.key]: lines.join('\n'),
                }
              })
            } else {
              setValues((state) => ({
                ...state,
                [browsingField.key]: selectedPath,
              }))
            }
            setBrowsingField(null)
          }}
          onClose={() => setBrowsingField(null)}
        />
      ) : null}
    </div>
  )
}
