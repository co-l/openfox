import { ScrollArea } from './ScrollArea'
import { Modal } from './Modal'
import { useState, useEffect, useRef, useMemo } from 'react'
import { authFetch } from '../../lib/api'
import type { Backend } from '../../stores/config'
import type { ModelConfig as SharedModelConfig } from '@shared/types.js'
import { ChevronDownIcon, EyeIcon, ReloadIcon, SettingsIcon } from './icons'
import { QueryParamsInput } from './QueryParamsInput'
import { formatTokens } from '../../lib/format-stats'
import { getLocale } from '@shared/i18n/index.js'
import { useT } from '../../hooks/useT'
import { shouldAutofocus } from '../../lib/device'
import { REASONING_EFFORT_VALUES } from '../../lib/model-value'
import { isSmallContext } from '../../lib/context-warning'
import { groupModeFamilies, MODE_SUFFIXES, splitModeSuffix } from '@shared/reasoning-effort.js'

const COMMON_PORTS = [8080, 11434, 8000, 1234, 8888]

interface ProviderPreset {
  id: string
  name: string
  description: string
  documentationUrl?: string
  requiresAuth: boolean
  authAdapter?: string
  transportAdapter?: string
  defaults: { name?: string; url: string; backend: string; models?: ModelInfo[] }
  connectLabel?: string
  disconnectLabel?: string
  missingPluginMessage?: string
}

type ModelInfo = Omit<SharedModelConfig, 'source'>

function defaultReasoningEffort(efforts: string[] | undefined): string | undefined {
  if (!efforts?.length) return undefined
  return efforts.includes('medium') ? 'medium' : efforts[0]
}

// Build a single merged ModelInfo from a mode-suffix family's base id, its
// (optionally present) un-suffixed base model, and its members. Shared by the
// auto-collapse path and the explicit re-merge path so the merged shape stays
// defined in one place.
function buildMergedModel(baseId: string, baseModel: ModelInfo | undefined, members: ModelInfo[]): ModelInfo {
  // Order members by semantic reasoning level (low → medium → high → xhigh →
  // max) rather than lexically, so displayed chips read predictably.
  const levelOrder = new Map<string, number>(MODE_SUFFIXES.map((s, i) => [s, i]))
  const sorted = [...members].sort((a, b) => {
    const la = splitModeSuffix(a.id)?.level
    const lb = splitModeSuffix(b.id)?.level
    const ia = la !== undefined ? (levelOrder.get(la) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
    const ib = lb !== undefined ? (levelOrder.get(lb) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
    return ia - ib || a.id.localeCompare(b.id)
  })
  return {
    id: baseId,
    name: baseModel?.name ?? sorted[0]?.name ?? baseId.split('/').pop() ?? baseId,
    apiModelId: baseModel?.apiModelId ?? (baseModel ? baseId : undefined),
    requestBody: baseModel?.requestBody,
    contextWindow: baseModel?.contextWindow ?? sorted[0]?.contextWindow ?? 200000,
    reasoningEfforts: sorted.map((m) => splitModeSuffix(m.id)?.level).filter((l): l is string => Boolean(l)),
    modes: sorted.map((m) => ({
      level: splitModeSuffix(m.id)!.level,
      apiModelId: m.apiModelId ?? m.id,
      ...(m.name !== undefined ? { name: m.name.split('/').pop() ?? m.name } : {}),
    })),
  }
}

interface ModelConfig {
  contextWindow: number
  supportsVision?: boolean
  thinkingEnabled?: boolean
  thinkingLevel?: string
  reasoningEfforts?: string[]
  reasoningEffortOverride?: string
  nonThinkingEnabled?: boolean
  thinkingExtraKwargs?: string
  nonThinkingExtraKwargs?: string
  thinkingQueryParams?: string
  nonThinkingQueryParams?: string
  omitParams?: string[]
  temperature?: number
  topP?: number
  topK?: number
  maxTokens?: number
  defaultTemperature?: number
  defaultTopP?: number
  defaultTopK?: number
  defaultMaxTokens?: number
  compactionThreshold?: number
}

export interface ProviderFormData {
  id: string
  name: string
  url: string
  backend: Backend
  apiKey?: string
  isLocal?: boolean
  thinkingField?: string
  sendReasoningInMessages?: boolean
  authAdapter?: string
  transportAdapter?: string
  models: Array<Omit<SharedModelConfig, 'source'>>
}

export function providerFormPayload(formData: ProviderFormData) {
  return {
    name: formData.name,
    url: formData.url,
    backend: formData.backend,
    apiKey: formData.apiKey,
    isLocal: formData.isLocal,
    thinkingField: formData.thinkingField,
    sendReasoningInMessages: formData.sendReasoningInMessages,
    authAdapter: formData.authAdapter,
    transportAdapter: formData.transportAdapter,
    models: formData.models,
  }
}

interface ProviderModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (provider: ProviderFormData) => void
  initialStep?: 1 | 2
  editProvider?: {
    id: string
    name: string
    url: string
    backend: Backend
    apiKey?: string
    isLocal?: boolean
    thinkingField?: string
    sendReasoningInMessages?: boolean
    authAdapter?: string
    transportAdapter?: string
    models?: Array<Omit<SharedModelConfig, 'source'>>
  }
  editModelId?: string
}

function ModelConfigPanel({
  model,
  modelConfigs,
  autoConfigState,
  testResults,
  onUpdateConfig,
  onRunAutoConfig,
  onTestParams,
  onShowRaw,
}: {
  model: ModelInfo
  modelConfigs: Record<string, ModelConfig>
  autoConfigState: { loading: boolean; progress: Record<string, 'pending' | 'probing' | 'done' | 'error'> }
  testResults: Record<string, { loading: boolean; result?: string; error?: string }>
  onUpdateConfig: (id: string, partial: Partial<ModelConfig>) => void
  onRunAutoConfig: (id: string) => void
  onTestParams: (id: string, mode: 'thinking' | 'non-thinking') => void
  onShowRaw: (data: string) => void
}) {
  const t = useT()
  function toggleOmitParam(modelId: string, paramKey: string) {
    const current = modelConfigs[modelId]?.omitParams ?? []
    const isOmitted = current.includes(paramKey)
    const next = isOmitted ? current.filter((p) => p !== paramKey) : [...current, paramKey]
    onUpdateConfig(modelId, { omitParams: next.length > 0 ? next : undefined })
  }

  /** The preset list currently in effect for a model (edited, else the stored one). */
  function presetEfforts(modelId: string): string[] {
    return modelConfigs[modelId]?.reasoningEfforts ?? model.reasoningEfforts ?? []
  }

  /** Add/remove a vocabulary value from the model's preset list. Removing the
   *  last chip persists an explicitly-EMPTY list (no chips) — distinct from
   *  "Reset to defaults", which clears the custom list so catalog defaults
   *  apply again. */
  function togglePresetEffort(modelId: string, effort: string) {
    const current = presetEfforts(modelId)
    const next = current.includes(effort) ? current.filter((e) => e !== effort) : [...current, effort]
    onUpdateConfig(modelId, { reasoningEfforts: next })
  }

  /** Swap a preset with its neighbour (direction -1 up / +1 down) to order the chips. */
  function movePresetEffort(modelId: string, effort: string, direction: -1 | 1) {
    const current = presetEfforts(modelId)
    const index = current.indexOf(effort)
    const target = index + direction
    if (index === -1 || target < 0 || target >= current.length) return
    const next = [...current]
    ;[next[index]!, next[target]!] = [next[target]!, next[index]!]
    onUpdateConfig(modelId, { reasoningEfforts: next })
  }

  return (
    <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => onRunAutoConfig(model.id)}
          disabled={autoConfigState.progress[model.id] === 'probing'}
          className="px-4 py-2 bg-accent-primary text-text-primary rounded-lg text-sm font-medium hover:bg-accent-primary/90 disabled:opacity-50 transition-colors"
        >
          {autoConfigState.progress[model.id] === 'probing'
            ? t({ en: 'Probing…', fr: 'Analyse…' })
            : t({ en: 'Auto-config', fr: 'Auto-configuration' })}
        </button>
        {autoConfigState.progress[model.id] === 'done' && (
          <span className="text-sm text-accent-success font-medium">
            {t({ en: 'Configured ✓', fr: 'Configuré ✓' })}
          </span>
        )}
        {autoConfigState.progress[model.id] === 'error' && (
          <span className="text-sm text-red-500 font-medium">{t({ en: 'Failed ✗', fr: 'Échec ✗' })}</span>
        )}
      </div>

      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs text-text-secondary block mb-1">
            {t({ en: 'Context window (tokens)', fr: 'Fenêtre de contexte (tokens)' })}
          </label>
          <input
            type="number"
            value={modelConfigs[model.id]?.contextWindow ?? model.contextWindow}
            onChange={(e) =>
              onUpdateConfig(model.id, {
                contextWindow: parseInt(e.target.value) || model.contextWindow,
              })
            }
            className="w-32 px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary"
          />
          {isSmallContext(modelConfigs[model.id]?.contextWindow ?? model.contextWindow) && (
            <p data-small-context className="text-[11px] text-accent-warning mt-1 w-40 leading-snug">
              {t({
                en: 'Small context — agent prompts may be truncated by the provider.',
                fr: 'Contexte réduit — les invites de l’agent peuvent être tronquées par le fournisseur.',
              })}
            </p>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary pb-1">
          <input
            type="checkbox"
            checked={modelConfigs[model.id]?.supportsVision ?? false}
            onChange={(e) => onUpdateConfig(model.id, { supportsVision: e.target.checked })}
            className="accent-accent-primary"
          />{' '}
          {t({ en: 'Supports vision', fr: 'Prend en charge la vision' })}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onTestParams(model.id, 'thinking')}
            disabled={testResults[model.id + '-thinking']?.loading}
            className="px-3 py-1.5 bg-bg-tertiary border border-border rounded text-xs font-medium hover:bg-bg-secondary disabled:opacity-50 transition-colors"
          >
            {testResults[model.id + '-thinking']?.loading
              ? t({ en: 'Testing…', fr: 'Test en cours…' })
              : t({ en: 'Test thinking', fr: 'Tester la réflexion' })}
          </button>
          {testResults[model.id + '-thinking']?.result && (
            <span className="text-xs text-accent-success">{t({ en: 'OK', fr: 'OK' })}</span>
          )}
          {testResults[model.id + '-thinking']?.error && (
            <span className="text-xs text-red-500" title={testResults[model.id + '-thinking']?.error}>
              {t({ en: 'Fail', fr: 'Échec' })}
            </span>
          )}
          {testResults[model.id + '-thinking']?.result && (
            <button
              onClick={() => onShowRaw(testResults[model.id + '-thinking']!.result!)}
              className="text-xs text-accent-primary hover:underline"
            >
              {t({ en: 'raw', fr: 'brut' })}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onTestParams(model.id, 'non-thinking')}
            disabled={testResults[model.id + '-non-thinking']?.loading}
            className="px-3 py-1.5 bg-bg-tertiary border border-border rounded text-xs font-medium hover:bg-bg-secondary disabled:opacity-50 transition-colors"
          >
            {testResults[model.id + '-non-thinking']?.loading
              ? t({ en: 'Testing…', fr: 'Test en cours…' })
              : t({ en: 'Test non-thinking', fr: 'Tester sans réflexion' })}
          </button>
          {testResults[model.id + '-non-thinking']?.result && (
            <span className="text-xs text-accent-success">{t({ en: 'OK', fr: 'OK' })}</span>
          )}
          {testResults[model.id + '-non-thinking']?.error && (
            <span className="text-xs text-red-500" title={testResults[model.id + '-non-thinking']?.error}>
              {t({ en: 'Fail', fr: 'Échec' })}
            </span>
          )}
          {testResults[model.id + '-non-thinking']?.result && (
            <button
              onClick={() => onShowRaw(testResults[model.id + '-non-thinking']!.result!)}
              className="text-xs text-accent-primary hover:underline"
            >
              {t({ en: 'raw', fr: 'brut' })}
            </button>
          )}
        </div>
      </div>

      <details className="group">
        <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary list-none flex items-center gap-1 select-none">
          <ChevronDownIcon className="w-3 h-3 transition-transform group-open:rotate-180" />
          {t({
            en: 'Advanced: thinking & non-thinking params',
            fr: 'Avancé : paramètres de réflexion et sans réflexion',
          })}
        </summary>
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={modelConfigs[model.id]?.thinkingEnabled ?? false}
              onChange={(e) => onUpdateConfig(model.id, { thinkingEnabled: e.target.checked })}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent-primary"
            />
            <span className="text-xs font-medium text-text-primary">{t({ en: 'Thinking', fr: 'Réflexion' })}</span>
          </label>
          {modelConfigs[model.id]?.thinkingEnabled && (
            <div className="ml-6 space-y-2 pl-3 border-l-2 border-accent-primary/30">
              <div>
                <label className="text-xs text-text-secondary block mb-1">
                  {t({ en: 'Reasoning effort', fr: 'Niveau de raisonnement' })}
                </label>
                {model.reasoningEfforts?.length ? (
                  <select
                    aria-label={t({ en: 'Reasoning effort', fr: 'Niveau de raisonnement' })}
                    value={modelConfigs[model.id]?.thinkingLevel ?? defaultReasoningEffort(model.reasoningEfforts)}
                    onChange={(e) => onUpdateConfig(model.id, { thinkingLevel: e.target.value })}
                    className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-xs text-text-primary"
                  >
                    {model.reasoningEfforts.map((effort) => (
                      <option key={effort} value={effort}>
                        {effort}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    aria-label={t({ en: 'Reasoning effort', fr: 'Niveau de raisonnement' })}
                    value={modelConfigs[model.id]?.thinkingLevel ?? ''}
                    onChange={(e) => onUpdateConfig(model.id, { thinkingLevel: e.target.value })}
                    className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-xs text-text-primary"
                  />
                )}
              </div>
              <QueryParamsInput
                value={modelConfigs[model.id]?.thinkingQueryParams}
                onChange={(v) => onUpdateConfig(model.id, { thinkingQueryParams: v })}
              />
            </div>
          )}

          <div className="space-y-2">
            <div>
              <label className="text-xs text-text-secondary block mb-1">
                {t({
                  en: 'Effort presets (shown as chips in the model selector)',
                  fr: 'Préréglages d’effort (affichés sous forme de pastilles dans le sélecteur de modèle)',
                })}
              </label>
              <div className="flex flex-wrap items-center gap-1">
                {presetEfforts(model.id).map((effort, index) => (
                  <span
                    key={effort}
                    className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-border text-text-muted"
                  >
                    {effort}
                    <button
                      type="button"
                      aria-label={t({
                        en: `Move preset ${effort} up`,
                        fr: `Déplacer le préréglage ${effort} vers le haut`,
                      })}
                      onClick={() => movePresetEffort(model.id, effort, -1)}
                      disabled={index === 0}
                      className="text-text-muted hover:text-text-primary leading-none disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={t({
                        en: `Move preset ${effort} down`,
                        fr: `Déplacer le préréglage ${effort} vers le bas`,
                      })}
                      onClick={() => movePresetEffort(model.id, effort, 1)}
                      disabled={index === presetEfforts(model.id).length - 1}
                      className="text-text-muted hover:text-text-primary leading-none disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label={t({ en: `Remove preset ${effort}`, fr: `Supprimer le préréglage ${effort}` })}
                      onClick={() => togglePresetEffort(model.id, effort)}
                      className="text-text-muted hover:text-accent-error leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <select
                  aria-label={t({ en: 'Add effort preset', fr: 'Ajouter un préréglage' })}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) togglePresetEffort(model.id, e.target.value)
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-bg-tertiary text-text-muted"
                >
                  <option value="">{t({ en: 'Add preset…', fr: 'Ajouter un préréglage…' })}</option>
                  {REASONING_EFFORT_VALUES.filter((v) => !presetEfforts(model.id).includes(v)).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              {modelConfigs[model.id]?.reasoningEfforts !== undefined && (
                <button
                  type="button"
                  onClick={() => onUpdateConfig(model.id, { reasoningEfforts: undefined })}
                  className="mt-1 text-[10px] text-text-muted hover:text-text-primary hover:underline"
                >
                  {t({ en: 'Reset to defaults', fr: 'Réinitialiser les valeurs par défaut' })}
                </button>
              )}
            </div>
            <div>
              <label className="text-xs text-text-secondary block mb-1">
                {t({
                  en: 'Reasoning effort override (raw value, sent verbatim)',
                  fr: 'Remplacement du niveau de raisonnement (valeur brute, envoyée telle quelle)',
                })}
              </label>
              <input
                type="text"
                aria-label={t({ en: 'Reasoning effort override', fr: 'Remplacement du niveau de raisonnement' })}
                value={modelConfigs[model.id]?.reasoningEffortOverride ?? model.reasoningEffortOverride ?? ''}
                onChange={(e) => onUpdateConfig(model.id, { reasoningEffortOverride: e.target.value || undefined })}
                placeholder={t({
                  en: 'e.g. deep — bypasses the preset list',
                  fr: 'ex. deep — contourne la liste des préréglages',
                })}
                className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded text-xs text-text-primary"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={modelConfigs[model.id]?.nonThinkingEnabled ?? false}
              onChange={(e) => onUpdateConfig(model.id, { nonThinkingEnabled: e.target.checked })}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent-primary"
            />
            <span className="text-xs font-medium text-text-primary">
              {t({ en: 'Non-thinking', fr: 'Sans réflexion' })}
            </span>
          </label>
          {modelConfigs[model.id]?.nonThinkingEnabled && (
            <div className="ml-6 space-y-2 pl-3 border-l-2 border-accent-warning/30">
              <QueryParamsInput
                value={modelConfigs[model.id]?.nonThinkingQueryParams}
                onChange={(v) => onUpdateConfig(model.id, { nonThinkingQueryParams: v })}
              />
            </div>
          )}
          {(modelConfigs[model.id]?.omitParams ?? []).includes('reasoning_effort') && (
            <label className="flex items-center gap-1.5 text-xs text-text-warning cursor-pointer select-none">
              <input
                type="checkbox"
                data-testid="re-enable-reasoning_effort"
                checked={false}
                onChange={() => toggleOmitParam(model.id, 'reasoning_effort')}
                className="accent-accent-primary"
              />
              {t({ en: 'Re-enable reasoning_effort', fr: 'Réactiver reasoning_effort' })}
            </label>
          )}
        </div>

        <div className="border-t border-border pt-3 mt-3">
          <p className="text-xs text-text-muted mb-2">
            {t({ en: 'Sampling parameters', fr: 'Paramètres d’échantillonnage' })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <SamplingParamField
              modelId={model.id}
              paramKey="temperature"
              label={t({ en: 'Temperature', fr: 'Température' })}
              step={0.1}
              value={modelConfigs[model.id]?.temperature}
              defaultValue={modelConfigs[model.id]?.defaultTemperature}
              omitParams={modelConfigs[model.id]?.omitParams}
              onUpdateConfig={onUpdateConfig}
              onToggleOmit={toggleOmitParam}
              parseValue={(v) => (v ? parseFloat(v) : undefined)}
              valueField="temperature"
            />
            <SamplingParamField
              modelId={model.id}
              paramKey="top_p"
              label={t({ en: 'Top P', fr: 'Top P' })}
              step={0.05}
              value={modelConfigs[model.id]?.topP}
              defaultValue={modelConfigs[model.id]?.defaultTopP}
              omitParams={modelConfigs[model.id]?.omitParams}
              onUpdateConfig={onUpdateConfig}
              onToggleOmit={toggleOmitParam}
              parseValue={(v) => (v ? parseFloat(v) : undefined)}
              valueField="topP"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <SamplingParamField
              modelId={model.id}
              paramKey="top_k"
              label={t({ en: 'Top K', fr: 'Top K' })}
              value={modelConfigs[model.id]?.topK}
              defaultValue={modelConfigs[model.id]?.defaultTopK}
              omitParams={modelConfigs[model.id]?.omitParams}
              onUpdateConfig={onUpdateConfig}
              onToggleOmit={toggleOmitParam}
              parseValue={(v) => (v ? parseInt(v) : undefined)}
              valueField="topK"
            />
            <SamplingParamField
              modelId={model.id}
              paramKey="max_tokens"
              label={t({ en: 'Max tokens', fr: 'Tokens max' })}
              value={modelConfigs[model.id]?.maxTokens}
              defaultValue={modelConfigs[model.id]?.defaultMaxTokens}
              omitParams={modelConfigs[model.id]?.omitParams}
              onUpdateConfig={onUpdateConfig}
              onToggleOmit={toggleOmitParam}
              parseValue={(v) => (v ? parseInt(v) : undefined)}
              valueField="maxTokens"
            />
          </div>
        </div>
        <div className="pt-3 border-t border-border">
          <AutoCompactionField
            value={modelConfigs[model.id]?.compactionThreshold}
            maxTokens={modelConfigs[model.id]?.contextWindow ?? model.contextWindow}
            onChange={(threshold) => onUpdateConfig(model.id, { compactionThreshold: threshold })}
          />
        </div>
      </details>
    </div>
  )
}

function SamplingParamField({
  modelId,
  paramKey,
  label,
  value,
  defaultValue,
  omitParams,
  onUpdateConfig,
  onToggleOmit,
  parseValue,
  valueField,
  step,
}: {
  modelId: string
  paramKey: string
  label: string
  value: number | undefined
  defaultValue: number | undefined
  omitParams: string[] | undefined
  onUpdateConfig: (id: string, partial: Partial<ModelConfig>) => void
  onToggleOmit: (modelId: string, paramKey: string) => void
  parseValue: (v: string) => number | undefined
  valueField: keyof ModelConfig
  step?: number
}) {
  const t = useT()
  const isOmitted = omitParams?.includes(paramKey) ?? false
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-xs text-text-secondary">{label}</label>
        <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            data-testid={`send-${paramKey}`}
            checked={!isOmitted}
            onChange={() => onToggleOmit(modelId, paramKey)}
            className="accent-accent-primary"
          />
          {t({ en: 'Send', fr: 'Envoyer' })}
        </label>
      </div>
      <input
        type="number"
        data-testid={`param-${paramKey}`}
        step={step}
        value={isOmitted ? '' : (value ?? '')}
        disabled={isOmitted}
        onChange={(e) => onUpdateConfig(modelId, { [valueField]: parseValue(e.target.value) } as Partial<ModelConfig>)}
        placeholder={
          isOmitted
            ? t({ en: 'Not sent', fr: 'Non envoyé' })
            : (defaultValue?.toString() ?? t({ en: 'Using default', fr: 'Valeur par défaut' }))
        }
        className="w-full px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary disabled:opacity-40"
      />
      {!isOmitted && defaultValue !== undefined && (
        <p className="text-xs text-text-muted mt-0.5">
          {t({ en: 'default: {{value}}', fr: 'défaut : {{value}}' }, { value: defaultValue })}
        </p>
      )}
    </div>
  )
}

function AutoCompactionField({
  value,
  maxTokens,
  onChange,
}: {
  value: number | undefined
  maxTokens: number
  onChange: (threshold: number | undefined) => void
}) {
  const t = useT()
  const MIN_TOKENS = 15_000
  const DEFAULT_THRESHOLD = 0.85

  const maxPercent = Math.min(95, Math.floor(((maxTokens - 5_000) / maxTokens) * 100))
  const minPercent = Math.min(maxPercent, Math.ceil((MIN_TOKENS / maxTokens) * 100))
  const effectiveThreshold = Math.min(value ?? DEFAULT_THRESHOLD, maxPercent / 100)
  const [percent, setPercent] = useState(Math.round(effectiveThreshold * 100))

  useEffect(() => {
    const clamped = Math.min(value ?? DEFAULT_THRESHOLD, maxPercent / 100)
    setPercent(Math.round(clamped * 100))
  }, [value, maxPercent])

  const thresholdTokens = Math.floor(maxTokens * (percent / 100))

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1">
        <label className="text-xs text-text-secondary">
          {t({ en: 'Auto-compaction threshold', fr: 'Seuil d’auto-compaction' })}
        </label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-text-primary">
            {`${percent}% · ${formatTokens(thresholdTokens)}`}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(undefined)
              setPercent(Math.round(DEFAULT_THRESHOLD * 100))
            }}
            disabled={value === undefined}
            className="text-xs text-accent-primary hover:underline disabled:text-text-muted disabled:no-underline"
          >
            {t({ en: 'Default', fr: 'Défaut' })}
          </button>
        </div>
      </div>
      <input
        aria-label={t({ en: 'Auto-compaction threshold', fr: 'Seuil d’auto-compaction' })}
        type="range"
        min={minPercent}
        max={maxPercent}
        step="1"
        value={percent}
        onChange={(e) => setPercent(Number(e.target.value))}
        onMouseUp={() => onChange(percent / 100)}
        onTouchEnd={() => onChange(percent / 100)}
        onBlur={() => onChange(percent / 100)}
        onKeyUp={() => onChange(percent / 100)}
        className="w-full"
      />
      <p className="text-[10px] text-text-muted mt-0.5">
        {t(
          {
            en: 'Minimum {{min}} tokens · maximum {{max}}% · default 85%',
            fr: 'Minimum {{min}} tokens · maximum {{max}}% · défaut 85%',
          },
          { min: formatTokens(MIN_TOKENS), max: maxPercent },
        )}
      </p>
    </div>
  )
}

export function ProviderModal({
  isOpen,
  onClose,
  onSave,
  initialStep = 1,
  editProvider,
  editModelId,
}: ProviderModalProps) {
  const t = useT()
  const [formStep, setFormStep] = useState(initialStep)
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formBackend, setFormBackend] = useState<string>('unknown')
  const [formApiKey, setFormApiKey] = useState('')
  const [formIsLocal, setFormIsLocal] = useState(false)
  const [formAuthAdapter, setFormAuthAdapter] = useState<string | undefined>()
  const [formTransportAdapter, setFormTransportAdapter] = useState<string | undefined>()
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null)
  const [showDefaults, setShowDefaults] = useState(false)
  const [thinkingField, setThinkingField] = useState('')
  const [sendReasoningInMessages, setSendReasoningInMessages] = useState(true)
  const [modelConfigs, setModelConfigs] = useState<Record<string, ModelConfig>>({})
  const [autoConfigState, setAutoConfigState] = useState<{
    loading: boolean
    progress: Record<string, 'pending' | 'probing' | 'done' | 'error'>
  }>({ loading: false, progress: {} })
  const [testResults, setTestResults] = useState<
    Record<string, { loading: boolean; result?: string; message?: Record<string, unknown>; error?: string }>
  >({})
  const [rawModalData, setRawModalData] = useState<string | null>(null)
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [draftProviderId, setDraftProviderId] = useState<string | null>(null)
  const [providerAuthState, setProviderAuthState] = useState<'disconnected' | 'pending' | 'connected' | 'error'>(
    'disconnected',
  )
  const [providerAuthBusy, setProviderAuthBusy] = useState(false)
  const [deviceChallenge, setDeviceChallenge] = useState<{
    mode?: 'device' | 'browser' | 'external'
    verificationUrl: string
    directUrl?: string
    userCode?: string
    instructions: string
  } | null>(null)
  const [providerPresets, setProviderPresets] = useState<ProviderPreset[]>([])
  const [devicePageOpened, setDevicePageOpened] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [manualModelId, setManualModelId] = useState('')
  const [manualModelError, setManualModelError] = useState<string | null>(null)
  const codeCopiedTimerRef = useRef<number | null>(null)
  const draftProviderSaved = useRef(false)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const manualModelInputRef = useRef<HTMLInputElement>(null)

  // Models that were already merged into mode chips (have a `modes` map).
  const mergedModeModels = useMemo(() => models.filter((m) => m.modes?.length), [models])
  // Families of suffixed variants still present in the list — only non-empty
  // after an Unmerge re-expands a merged model, so a Merge button appears then
  // only (auto-collapse clears them at init/fetch).
  const mergeableGroups = useMemo(() => groupModeFamilies(models.filter((m) => splitModeSuffix(m.id))), [models])

  useEffect(() => {
    if (formStep === 1 && isOpen) {
      // Small delay to ensure the input is mounted
      requestAnimationFrame(() => {
        if (shouldAutofocus()) urlInputRef.current?.focus()
      })
    }
  }, [formStep, isOpen])

  useEffect(() => {
    return () => {
      if (codeCopiedTimerRef.current !== null) {
        window.clearTimeout(codeCopiedTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    // Authorized transient read: provider presets are a one-shot form load.
    void authFetch('/api/provider-presets')
      .then(async (response) =>
        response.ok ? ((await response.json()) as { presets: ProviderPreset[] }) : { presets: [] },
      )
      .then((data) => setProviderPresets(data.presets))
      .catch(() => setProviderPresets([]))
  }, [isOpen])

  function updateModelConfig(id: string, partial: Partial<ModelConfig>) {
    setModelConfigs((prev) => ({ ...prev, [id]: { ...prev[id]!, ...partial } }))
  }

  function selectModel(model: ModelInfo) {
    setSelectedModelIds((current) => new Set(current).add(model.id))
    setModelConfigs((current) => ({
      ...current,
      [model.id]: {
        contextWindow: model.contextWindow,
        ...current[model.id],
      },
    }))
  }

  function filterModels(query: string): ModelInfo[] {
    if (!query.trim()) return models
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return models.filter((m) => terms.every((t) => m.id.toLowerCase().includes(t)))
  }

  // Re-merge a detected suffixed family (present after an Unmerge) back into a
  // single mode-chip model, migrating per-model configs and selection from the
  // member ids onto the merged id so nothing is lost.
  function mergeModeFamily(baseId: string, members: ModelInfo[]) {
    const baseModel = models.find((m) => m.id === baseId)
    const merged = buildMergedModel(baseId, baseModel, members)
    const removedIds = new Set(members.map((m) => m.id))
    setModels((current) => [merged, ...current.filter((m) => !removedIds.has(m.id) && m.id !== baseId)])
    // Migrate member configs onto the merged id.
    setModelConfigs((current) => {
      const next = { ...current }
      for (const memberId of removedIds) {
        const config = next[memberId]
        if (config && !next[baseId]) next[baseId] = config
        delete next[memberId]
      }
      return next
    })
    // If any member was selected, select the merged model.
    const anySelected = [...removedIds].some((id) => selectedModelIds.has(id))
    if (anySelected) {
      setSelectedModelIds((current) => {
        const next = new Set(current)
        for (const id of removedIds) next.delete(id)
        next.add(baseId)
        return next
      })
    }
  }

  // Expand a merged mode model back into its per-level members. Each entry in
  // the model's `modes` becomes a distinct suffixed model; the merged (base)
  // entry is removed. Any per-model config keyed on the merged id is cloned
  // (per-member) onto each expanded member so no user settings are lost on
  // unmerge and later per-level edits don't leak across members.
  function unmergeModeFamily(merged: ModelInfo) {
    if (!merged.modes?.length) return
    const members: ModelInfo[] = merged.modes.map((mode) => ({
      id: mode.apiModelId ?? merged.id,
      ...(mode.name !== undefined ? { name: mode.name } : {}),
      apiModelId: mode.apiModelId ?? merged.id,
      contextWindow: merged.contextWindow,
      ...(merged.requestBody !== undefined ? { requestBody: merged.requestBody } : {}),
      ...(merged.supportsVision !== undefined ? { supportsVision: merged.supportsVision } : {}),
    }))
    setModels((current) => [...members, ...current.filter((m) => m.id !== merged.id)])
    const mergedConfig = modelConfigs[merged.id]
    if (mergedConfig) {
      setModelConfigs((current) => {
        const next = { ...current }
        delete next[merged.id]
        for (const member of members) next[member.id] = { ...mergedConfig }
        return next
      })
    }
    // If the merged model was selected, select its members; otherwise leave the
    // selection untouched so the previously selected levels carry over.
    if (selectedModelIds.has(merged.id)) {
      setSelectedModelIds((current) => {
        const next = new Set(current)
        next.delete(merged.id)
        for (const member of members) next.add(member.id)
        return next
      })
    }
  }

  function addManualModel() {
    const trimmed = manualModelId.trim()
    if (!trimmed) {
      setManualModelError(t({ en: 'Enter a model name', fr: 'Saisissez un nom de modèle' }))
      return
    }

    // Detect duplicates against existing models, normalizing the same way the
    // server does (lowercase, ignore -_:. and whitespace) so "my-model" and
    // "my_model" are treated as the same model.
    const normalize = (s: string) => s.toLowerCase().replace(/[-_\s:.]+/g, '')
    const normalized = normalize(trimmed)
    const existing = models.find((m) => normalize(m.id) === normalized)
    if (existing) {
      // Already present: just select it instead of duplicating.
      selectModel(existing)
      setManualModelError(
        t({ en: `"${existing.id}" is already in the list`, fr: `« ${existing.id} » figure déjà dans la liste` }),
      )
      setManualModelId('')
      if (!formAuthAdapter && autoConfigState.progress[existing.id] !== 'probing') {
        runAutoConfig(existing.id)
      }
      return
    }

    const newModel: ModelInfo = {
      id: trimmed,
      contextWindow: 200000,
    }
    setModels((prev) => [...prev, newModel])
    setSelectedModelIds((current) => new Set(current).add(newModel.id))
    setModelConfigs((current) => ({
      ...current,
      [newModel.id]: {
        contextWindow: newModel.contextWindow,
        thinkingEnabled: true,
      },
    }))
    setExpandedModelId(newModel.id)
    setManualModelId('')
    setManualModelError(null)
    // The user has resolved the discovery failure on their own.
    setFetchError(null)
  }

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setFormStep(initialStep)
      setFormName(editProvider?.name ?? '')
      setFormUrl(editProvider?.url ?? '')
      setFormBackend(editProvider?.backend ?? 'unknown')
      setFormApiKey(editProvider?.apiKey ?? '')
      setFormIsLocal(editProvider?.isLocal ?? false)
      setFormAuthAdapter(editProvider?.authAdapter)
      setFormTransportAdapter(editProvider?.transportAdapter)
      setFetchError(null)
      setThinkingField(editProvider?.thinkingField ?? '')
      setSendReasoningInMessages(editProvider?.sendReasoningInMessages ?? true)
      setTestResults({})
      setRawModalData(null)
      setDraftProviderId(null)
      setProviderAuthState('disconnected')
      setDeviceChallenge(null)
      setDevicePageOpened(false)
      setCodeCopied(false)
      setManualModelId('')
      setManualModelError(null)

      if (editProvider?.models?.length) {
        const configs: Record<string, ModelConfig> = {}
        const selected = new Set<string>()
        for (const m of editProvider.models) {
          configs[m.id] = {
            contextWindow: m.contextWindow,
            supportsVision: m.supportsVision,
            thinkingEnabled: m.thinkingEnabled,
            thinkingLevel: m.thinkingLevel ?? defaultReasoningEffort(m.reasoningEfforts),
            nonThinkingEnabled: m.nonThinkingEnabled,
            thinkingQueryParams: m.thinkingQueryParams,
            nonThinkingQueryParams: m.nonThinkingQueryParams,
            omitParams: m.omitParams,
            defaultTemperature: m.defaultTemperature,
            defaultTopP: m.defaultTopP,
            defaultTopK: m.defaultTopK,
            defaultMaxTokens: m.defaultMaxTokens,
            temperature: m.temperature,
            topP: m.topP,
            topK: m.topK,
            maxTokens: m.maxTokens,
            compactionThreshold: m.compactionThreshold,
          }
          if (m.selected) selected.add(m.id)
        }
        // Auto-select all models if none explicitly selected (legacy / single-model)
        if (selected.size === 0) {
          for (const m of editProvider.models) selected.add(m.id)
        }
        setSelectedModelIds(selected)
        setModelConfigs(configs)
        setModels(editProvider.models)
        setExpandedModelId(editModelId ?? editProvider.models[0]?.id ?? null)
      } else {
        setModels([])
        setModelConfigs({})
        setExpandedModelId(null)
        setSelectedModelIds(new Set())
      }
    }
  }, [isOpen, initialStep, editProvider?.id, editModelId])

  // Auto-fetch models when entering step 2. Preserved merged mode-chip models
  // (from a saved provider) are kept intact by fetchModels — the raw catalog
  // fetch filters out suffixed variants already claimed by a merged model, so
  // newly-added catalog models still surface without clobbering merged state.
  useEffect(() => {
    const requiresAuthentication = Boolean(formAuthAdapter)
    const onlyMergedInList = models.length > 0 && models.every((m) => m.modes?.length)
    if (
      formStep === 2 &&
      formUrl &&
      (models.length === 0 || onlyMergedInList) &&
      !fetchingModels &&
      !fetchError &&
      (!requiresAuthentication || providerAuthState === 'connected')
    ) {
      fetchModels(formUrl)
    }
  }, [formStep, providerAuthState])

  useEffect(() => {
    if (!isOpen || !formAuthAdapter || !editProvider?.id) return
    void refreshProviderAuthStatus(editProvider.id)
  }, [isOpen, formTransportAdapter, editProvider?.id])

  useEffect(() => {
    if (!deviceChallenge) return
    const providerId = editProvider?.id ?? draftProviderId
    if (!providerId) return

    let cancelled = false
    const checkConnection = async () => {
      const state = await refreshProviderAuthStatus(providerId)
      if (cancelled || state !== 'connected') return
      setDeviceChallenge(null)
      setDevicePageOpened(false)
      setCodeCopied(false)
      await fetchModels(formUrl)
    }

    void checkConnection()
    const interval = window.setInterval(() => void checkConnection(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [deviceChallenge, draftProviderId, editProvider?.id])

  async function ensureDraftProvider(): Promise<string> {
    if (editProvider?.id) return editProvider.id
    if (draftProviderId) return draftProviderId

    const response = await authFetch('/api/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formName || 'Provider',
        url: formUrl,
        backend: formBackend,
        authAdapter: formAuthAdapter,
        transportAdapter: formTransportAdapter,
        isLocal: false,
        models: [],
      }),
    })
    if (!response.ok) throw new Error(t({ en: 'Unable to create provider', fr: 'Impossible de créer le fournisseur' }))
    const data = (await response.json()) as { provider: { id: string } }
    setDraftProviderId(data.provider.id)
    return data.provider.id
  }

  async function refreshProviderAuthStatus(providerId: string) {
    // Authorized transient read: provider auth status is a one-shot check, not shared state.
    const response = await authFetch(`/api/provider-auth/${providerId}/status`)
    if (!response.ok) return 'error' as const
    const data = (await response.json()) as { state: 'disconnected' | 'pending' | 'connected' | 'expired' | 'error' }
    const state =
      data.state === 'connected'
        ? 'connected'
        : data.state === 'pending'
          ? 'pending'
          : data.state === 'error'
            ? 'error'
            : 'disconnected'
    setProviderAuthState(state)
    return state
  }

  async function connectProvider() {
    setProviderAuthBusy(true)
    setProviderAuthState('pending')
    try {
      const providerId = await ensureDraftProvider()
      const response = await authFetch(`/api/provider-auth/${providerId}/login`, { method: 'POST' })
      if (!response.ok)
        throw new Error(
          t({ en: 'Unable to start provider sign-in', fr: 'Impossible de démarrer la connexion du fournisseur' }),
        )
      const challenge = (await response.json()) as {
        mode?: 'device' | 'browser' | 'external'
        verificationUrl: string
        directUrl?: string
        userCode?: string
        instructions: string
      }
      setDeviceChallenge(challenge)
    } catch {
      setProviderAuthState('error')
    } finally {
      setProviderAuthBusy(false)
    }
  }

  async function copyDeviceCode() {
    if (!deviceChallenge?.userCode) return
    await navigator.clipboard?.writeText(deviceChallenge.userCode)
    if (codeCopiedTimerRef.current !== null) window.clearTimeout(codeCopiedTimerRef.current)
    setCodeCopied(false)
    requestAnimationFrame(() => setCodeCopied(true))
    codeCopiedTimerRef.current = window.setTimeout(() => {
      setCodeCopied(false)
      codeCopiedTimerRef.current = null
    }, 1500)
  }

  function openDeviceAuthorization() {
    if (!deviceChallenge) return
    window.open(deviceChallenge.directUrl ?? deviceChallenge.verificationUrl, '_blank', 'noopener,noreferrer')
    setDevicePageOpened(true)
  }

  async function fetchModels(url: string) {
    setFetchingModels(true)
    setFetchError(null)
    const isInitialEmpty = !editProvider && models.length === 0 && selectedModelIds.size === 0
    // Preserve any already-merged mode-chip models so newly-fetched raw catalog
    // data doesn't clobber user-collapsed families.
    const preservedMerged = models.filter((m) => m.modes?.length)
    try {
      const params = new URLSearchParams({ url })
      if (formApiKey) params.set('apiKey', formApiKey)
      if (formBackend) params.set('backend', formBackend)
      // Authorized transient read: provider models catalog is an interactive connectivity test result, not shared state.
      const response = formTransportAdapter
        ? await authFetch(`/api/providers/${await ensureDraftProvider()}/models`)
        : await authFetch(`/api/providers/models?${params.toString()}`)
      if (response.ok) {
        const data = (await response.json()) as { models: ModelInfo[]; url: string }
        if (data.models?.length) {
          // Suffixed catalog variants already represented by an existing or merged
          // model must not reappear alongside it (mirrors the server-side
          // `claimedByMergedModes` filter in provider-manager.ts).
          const claimed = new Set<string>()
          for (const merged of preservedMerged) {
            claimed.add(merged.id)
            for (const mode of merged.modes ?? []) {
              if (mode.apiModelId) claimed.add(mode.apiModelId)
            }
          }
          const filteredRaw: ModelInfo[] = []
          for (const m of data.models) {
            if (!claimed.has(m.id)) {
              claimed.add(m.id)
              filteredRaw.push(m)
            }
          }
          const combined = [...preservedMerged, ...filteredRaw]
          setModels(combined)
          setExpandedModelId((current) => (current && combined.some((m) => m.id === current) ? current : null))
          setModelConfigs((current) => {
            const next: Record<string, ModelConfig> = { ...current }
            for (const m of filteredRaw) {
              if (next[m.id]) continue
              next[m.id] = {
                contextWindow: m.contextWindow,
                supportsVision: m.supportsVision,
                thinkingEnabled: true,
                thinkingLevel: defaultReasoningEffort(m.reasoningEfforts),
                defaultTemperature: (m as { defaultTemperature?: number }).defaultTemperature,
                defaultTopP: (m as { defaultTopP?: number }).defaultTopP,
                defaultTopK: (m as { defaultTopK?: number }).defaultTopK,
                defaultMaxTokens: (m as { defaultMaxTokens?: number }).defaultMaxTokens,
              }
            }
            return next
          })
          if (isInitialEmpty && combined.length === 1) {
            setSelectedModelIds(new Set([combined[0]!.id]))
            setExpandedModelId(combined[0]!.id)
            runAutoConfig(combined[0]!.id)
          } else {
            setSelectedModelIds((current) => new Set([...current].filter((id) => combined.some((m) => m.id === id))))
          }
        }
      } else {
        const data = (await response.json()) as { error?: string; url?: string }
        setFetchError(data.error ?? `Failed to fetch models from ${url}`)
      }
    } catch (error) {
      setFetchError(`Failed to fetch models from ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
    setFetchingModels(false)
  }

  async function runAutoConfig(modelId: string) {
    setAutoConfigState((prev) => ({
      loading: true,
      progress: { ...prev.progress, [modelId]: 'probing' },
    }))
    try {
      const response = await authFetch('/api/providers/auto-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: formUrl,
          apiKey: formApiKey || undefined,
          backend: formBackend || 'unknown',
          models: [{ id: modelId }],
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error ?? 'Auto-config failed')
      }
      const data = (await response.json()) as {
        models: Array<{
          id: string
          contextWindow: number
          contextSource: 'backend' | 'hardcoded' | 'default'
          supportsVision: boolean
          thinkingConfig: Record<string, unknown> | null
          nonThinkingConfig: Record<string, unknown> | null
          sendReasoningInMessages?: boolean
          thinkingField?: string
          rejectedParams?: string[]
          reasoningEfforts?: string[]
          defaultReasoningEffort?: string
        }>
      }
      for (const m of data.models) {
        const config: Partial<ModelConfig> = {}
        // Only apply context/supportsvision when reliably detected
        if (m.contextSource !== 'default') {
          config.contextWindow = m.contextWindow
          config.supportsVision = m.supportsVision
        }
        if (m.thinkingConfig) {
          config.thinkingEnabled = true
          config.thinkingQueryParams = JSON.stringify(m.thinkingConfig)
          const current = modelConfigs[m.id]
          // Discovered reasoning efforts imply thinking support. Default the
          // thinking level (prefer the probe/catalog default) so it isn't inert.
          config.thinkingLevel =
            current?.thinkingLevel ?? m.defaultReasoningEffort ?? defaultReasoningEffort(m.reasoningEfforts)
        }
        if (m.nonThinkingConfig) {
          config.nonThinkingEnabled = true
          config.nonThinkingQueryParams = JSON.stringify(m.nonThinkingConfig)
        }
        if (m.sendReasoningInMessages === false) {
          setSendReasoningInMessages(false)
        }
        if (m.thinkingField) {
          setThinkingField(m.thinkingField)
        }
        if (m.rejectedParams && m.rejectedParams.length > 0) {
          config.omitParams = m.rejectedParams
        }
        if (m.reasoningEfforts && m.reasoningEfforts.length > 0) {
          // Keep the advertised effort list even without a detected thinking
          // combo, so the UI can still offer effort chips for the model.
          config.reasoningEfforts = m.reasoningEfforts
        }
        updateModelConfig(m.id, config)
        setAutoConfigState((prev) => ({
          ...prev,
          progress: { ...prev.progress, [m.id]: 'done' },
        }))
      }
    } catch (error) {
      console.error('Auto-config error:', error)
      setAutoConfigState((prev) => ({
        ...prev,
        progress: { ...prev.progress, [modelId]: 'error' },
      }))
    } finally {
      setAutoConfigState((prev) => ({ ...prev, loading: false }))
    }
  }

  async function testParams(modelId: string, mode: 'thinking' | 'non-thinking') {
    const key = modelId + '-' + mode
    setTestResults((prev) => ({ ...prev, [key]: { loading: true } }))
    try {
      const config = modelConfigs[modelId]
      const response = await authFetch('/api/providers/test-params', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: formUrl,
          providerId: editProvider?.id ?? draftProviderId ?? undefined,
          transportAdapter: formTransportAdapter,
          model: modelId,
          apiKey: formApiKey || undefined,
          backend: formBackend || 'unknown',
          thinkingField: thinkingField || undefined,
          mode,
          modelConfig: {
            temperature: config?.temperature,
            topP: config?.topP,
            topK: config?.topK,
            maxTokens: config?.maxTokens,
            supportsVision: config?.supportsVision,
            thinkingEnabled: config?.thinkingEnabled,
            thinkingLevel: config?.thinkingLevel,
            nonThinkingEnabled: config?.nonThinkingEnabled,
            thinkingQueryParams: config?.thinkingQueryParams,
            nonThinkingQueryParams: config?.nonThinkingQueryParams,
            omitParams: config?.omitParams,
          },
        }),
      })
      const data = await response.json()
      if (response.ok) {
        setTestResults((prev) => ({
          ...prev,
          [key]: { loading: false, result: JSON.stringify(data, null, 2), message: data.message },
        }))
      } else {
        setTestResults((prev) => ({ ...prev, [key]: { loading: false, error: data.error ?? 'Test failed' } }))
      }
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [key]: { loading: false, error: error instanceof Error ? error.message : 'Request failed' },
      }))
    }
  }

  function resetStep2() {
    setModels([])
    setModelConfigs({})
    setAutoConfigState({ loading: false, progress: {} })
    setTestResults({})
    setRawModalData(null)
    setSelectedModelIds(new Set())
    setSearchQuery('')
    setManualModelId('')
    setManualModelError(null)
  }

  function handleClose() {
    if (draftProviderId && !draftProviderSaved.current) {
      authFetch(`/api/providers/${draftProviderId}`, { method: 'DELETE' }).catch((err) => {
        console.warn('Failed to clean up draft provider', err)
      })
    }
    onClose()
  }

  function handleSave() {
    const name = formName || `Provider`
    const providerId = editProvider?.id ?? draftProviderId ?? `temp-${Date.now()}`
    onSave({
      id: providerId,
      name,
      url: formUrl,
      backend: (formBackend || 'unknown') as Backend,
      apiKey: formApiKey || undefined,
      isLocal: formIsLocal,
      thinkingField: thinkingField || undefined,
      sendReasoningInMessages,
      authAdapter: formAuthAdapter,
      transportAdapter: formTransportAdapter,
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        apiModelId: m.apiModelId,
        requestBody: m.requestBody,
        reasoningEfforts: modelConfigs[m.id]?.reasoningEfforts ?? m.reasoningEfforts,
        reasoningEffortOverride: modelConfigs[m.id]?.reasoningEffortOverride ?? m.reasoningEffortOverride,
        modes: m.modes,
        contextWindow: modelConfigs[m.id]?.contextWindow ?? m.contextWindow,
        selected: selectedModelIds.has(m.id) || undefined,
        supportsVision: modelConfigs[m.id]?.supportsVision,
        thinkingEnabled: modelConfigs[m.id]?.thinkingEnabled,
        thinkingLevel: modelConfigs[m.id]?.thinkingLevel,
        nonThinkingEnabled: modelConfigs[m.id]?.nonThinkingEnabled,
        thinkingQueryParams: modelConfigs[m.id]?.thinkingQueryParams,
        nonThinkingQueryParams: modelConfigs[m.id]?.nonThinkingQueryParams,
        omitParams: modelConfigs[m.id]?.omitParams,
        temperature: modelConfigs[m.id]?.temperature,
        topP: modelConfigs[m.id]?.topP,
        topK: modelConfigs[m.id]?.topK,
        maxTokens: modelConfigs[m.id]?.maxTokens,
        defaultMaxTokens: modelConfigs[m.id]?.defaultMaxTokens,
        defaultTemperature: modelConfigs[m.id]?.defaultTemperature,
        defaultTopP: modelConfigs[m.id]?.defaultTopP,
        defaultTopK: modelConfigs[m.id]?.defaultTopK,
        compactionThreshold: modelConfigs[m.id]?.compactionThreshold,
      })),
    })
    draftProviderSaved.current = true
    onClose()
  }

  if (!isOpen) return null

  const footer = (
    <div className="flex items-center justify-between">
      <div>
        {formStep > 1 && (
          <button
            onClick={() => {
              if (formStep === 2) resetStep2()
              setFormStep((formStep - 1) as 1 | 2)
            }}
            className="text-sm text-text-muted hover:text-text-secondary transition-colors"
          >
            ← {t({ en: 'Back', fr: 'Retour' })}
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleClose}
          className="px-4 py-2 text-sm text-text-muted hover:text-text-secondary transition-colors"
        >
          {t({ en: 'Cancel', fr: 'Annuler' })}
        </button>
        {formStep === 1 ? (
          <button
            onClick={() => setFormStep(2)}
            disabled={!formUrl}
            data-testid="provider-modal-next"
            className="px-5 py-2 bg-accent-primary text-text-primary rounded-lg text-sm font-medium hover:bg-accent-primary/90 disabled:opacity-50 transition-colors"
          >
            {t({ en: 'Next — Test & Configure', fr: 'Suivant — Tester et configurer' })}
          </button>
        ) : (
          <button
            onClick={handleSave}
            disabled={autoConfigState.loading}
            data-testid="provider-modal-save"
            className="px-5 py-2 bg-accent-primary text-text-primary rounded-lg text-sm font-medium hover:bg-accent-primary/90 disabled:opacity-50 transition-colors"
          >
            {autoConfigState.loading
              ? t({ en: 'Configuring…', fr: 'Configuration…' })
              : t({ en: 'Save Provider', fr: 'Enregistrer le fournisseur' })}
          </button>
        )}
      </div>
    </div>
  )

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={
          editProvider
            ? t({ en: 'Edit Provider', fr: 'Modifier le fournisseur' })
            : t({ en: 'Add Provider', fr: 'Ajouter un fournisseur' })
        }
        size="xl"
        footer={footer}
        closeOnBackdropClick={false}
        closeOnEscape={!showDefaults && !rawModalData}
      >
        {/* Step indicator */}
        <div className="flex gap-1.5 pt-2">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                s < formStep ? 'bg-accent-success' : s === formStep ? 'bg-accent-primary' : 'bg-border'
              }`}
            />
          ))}
        </div>

        {/* Step 1: Basic Info */}
        {formStep === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-text-secondary mb-2">
                {t({ en: 'Inference engine', fr: 'Moteur d’inférence' })}
              </label>
              {/* Engine cards share one row on wide screens and wrap into equal-width
                  rows when the viewport narrows, so labels never truncate. */}
              <div className="flex flex-wrap gap-2">
                {providerPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setFormName(preset.defaults.name ?? preset.name)
                      setFormUrl(preset.defaults.url)
                      setFormBackend(preset.defaults.backend)
                      setFormIsLocal(false)
                      setFormApiKey('')
                      setFormAuthAdapter(preset.authAdapter)
                      setFormTransportAdapter(preset.transportAdapter)
                      setFetchError(null)
                      resetStep2()
                    }}
                    className={`flex-1 min-w-fit px-2 py-2 whitespace-nowrap rounded border text-center text-sm transition-colors ${
                      formTransportAdapter && formTransportAdapter === preset.transportAdapter
                        ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                        : 'border-border hover:border-text-muted text-text-secondary'
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
                <button
                  key="other"
                  type="button"
                  onClick={() => {
                    setFormBackend('unknown')
                    setFormIsLocal(false)
                    setFormAuthAdapter(undefined)
                    setFormTransportAdapter(undefined)
                    setFetchError(null)
                    resetStep2()
                  }}
                  className={`flex-1 min-w-fit px-2 py-2 whitespace-nowrap rounded border text-center text-sm transition-colors ${
                    formBackend === 'unknown'
                      ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                      : 'border-border hover:border-text-muted text-text-secondary'
                  }`}
                >
                  {t({ en: 'Other', fr: 'Autre' })}
                </button>
                {COMMON_PORTS.map((port) => {
                  const backendMap: Record<number, string> = {
                    8000: 'vllm',
                    11434: 'ollama',
                    8080: 'llamacpp',
                    1234: 'lmstudio',
                    8888: 'unsloth',
                  }
                  const nameMap: Record<number, string> = {
                    8000: 'vLLM',
                    11434: 'Ollama',
                    8080: 'llama.cpp',
                    1234: 'LM Studio',
                    8888: 'Unsloth',
                  }
                  return (
                    <button
                      key={port}
                      type="button"
                      onClick={() => {
                        setFormName(nameMap[port] ?? '')
                        setFormUrl(`http://localhost:${port}`)
                        setFormBackend(backendMap[port] ?? '')
                        setFormIsLocal(true)
                        setFormAuthAdapter(undefined)
                        setFormTransportAdapter(undefined)
                        setFetchError(null)
                        resetStep2()
                      }}
                      className={`flex-1 min-w-fit px-2 py-2 whitespace-nowrap rounded border text-center text-sm transition-colors ${
                        formBackend === backendMap[port]
                          ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                          : 'border-border hover:border-text-muted text-text-secondary'
                      }`}
                    >
                      {nameMap[port] ?? `localhost:${port}`}
                    </button>
                  )
                })}
              </div>
            </div>

            {!formAuthAdapter && (
              <div>
                <label className="block text-sm text-text-secondary mb-1">
                  {t({ en: 'Provider URL', fr: 'URL du fournisseur' })}
                </label>
                <input
                  ref={urlInputRef}
                  type="text"
                  value={formUrl}
                  data-testid="provider-modal-url"
                  onChange={(e) => {
                    setFormUrl(e.target.value)
                    setFetchError(null)
                    setModels([])
                    setModelConfigs({})
                  }}
                  placeholder="http://localhost:8000"
                  className="w-full px-4 py-2 bg-bg-primary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
                />
              </div>
            )}

            <div>
              <label className="block text-sm text-text-secondary mb-1">
                {t({ en: 'Provider name', fr: 'Nom du fournisseur' })}
              </label>
              <input
                type="text"
                autoComplete="off"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t({ en: 'My LLM Server', fr: 'Mon serveur LLM' })}
                className="w-full px-4 py-2 bg-bg-primary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
              />
            </div>

            {!formAuthAdapter && (
              <div>
                <label className="block text-sm text-text-secondary mb-1">
                  {t({ en: 'API key', fr: 'Clé API' })}{' '}
                  <span className="text-text-muted">{t({ en: '(optional)', fr: '(facultatif)' })}</span>
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-4 py-2 bg-bg-primary border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
                />
              </div>
            )}

            {!formAuthAdapter && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formIsLocal}
                  onChange={(e) => setFormIsLocal(e.target.checked)}
                  className="w-4 h-4 rounded border-border bg-bg-primary accent-accent-primary"
                />
                <span className="text-sm text-text-secondary">
                  {t({ en: 'This is a local provider', fr: 'Fournisseur local' })}
                </span>
              </label>
            )}
          </div>
        )}

        {/* Step 2: Test & Configure Models */}
        {formStep === 2 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-text-primary">
                {t({ en: 'Test & Configure Models', fr: 'Tester et configurer les modèles' })}
              </h4>
              <button
                type="button"
                onClick={() => setShowDefaults(true)}
                className="p-1.5 text-text-muted hover:text-text-primary rounded transition-colors"
                title={t({ en: 'Provider-level defaults', fr: 'Valeurs par défaut du fournisseur' })}
              >
                <SettingsIcon className="w-4 h-4" />
              </button>
            </div>
            {Boolean(formAuthAdapter) && (
              <div className="rounded-lg border border-border bg-bg-primary p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-text-primary">
                      {t({ en: 'Connect provider', fr: 'Connecter le fournisseur' })}
                    </h4>
                    <p className="mt-1 text-xs text-text-muted">
                      {t({
                        en: 'Connect this provider before choosing available models.',
                        fr: 'Connectez ce fournisseur avant de choisir les modèles disponibles.',
                      })}
                    </p>
                  </div>
                  {providerAuthState === 'connected' ? (
                    <span className="text-sm font-medium text-accent-success">
                      {t({ en: 'Connected ✓', fr: 'Connecté ✓' })}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void connectProvider()}
                      disabled={providerAuthBusy || providerAuthState === 'pending'}
                      className="rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
                    >
                      {providerAuthBusy || providerAuthState === 'pending'
                        ? t({ en: 'Connecting…', fr: 'Connexion…' })
                        : providerAuthState === 'error'
                          ? t({ en: 'Retry', fr: 'Réessayer' })
                          : t({ en: 'Connect', fr: 'Connecter' })}
                    </button>
                  )}
                </div>
                {deviceChallenge && (
                  <div className="mt-4 border-t border-border pt-4">
                    {deviceChallenge.mode !== 'browser' ? (
                      <>
                        <p className="text-xs text-text-muted">
                          {t({
                            en: 'Use this code to complete authorization:',
                            fr: 'Utilisez ce code pour finaliser l’autorisation :',
                          })}
                        </p>
                        <button
                          type="button"
                          onClick={() => void copyDeviceCode()}
                          className="mt-3 w-full rounded-lg border border-accent-primary/40 px-4 py-4 font-mono text-2xl font-semibold tracking-[0.2em] text-accent-primary"
                        >
                          {deviceChallenge.userCode ?? t({ en: 'Continue', fr: 'Continuer' })}
                        </button>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void copyDeviceCode()}
                            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm text-text-primary"
                          >
                            {codeCopied
                              ? t({ en: 'Copied', fr: 'Copié' })
                              : t({ en: 'Copy code', fr: 'Copier le code' })}
                          </button>
                          <button
                            type="button"
                            onClick={openDeviceAuthorization}
                            className="flex-1 rounded-lg bg-accent-primary px-3 py-2 text-sm font-medium text-text-primary"
                          >
                            {devicePageOpened
                              ? t({ en: 'Reopen authorization', fr: 'Rouvrir l’autorisation' })
                              : t({ en: 'Open authorization', fr: 'Ouvrir l’autorisation' })}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-text-muted mb-3">{deviceChallenge.instructions}</p>
                        <button
                          type="button"
                          onClick={openDeviceAuthorization}
                          className="w-full rounded-lg bg-accent-primary px-3 py-2 text-sm font-medium text-text-primary"
                        >
                          {devicePageOpened
                            ? t({ en: 'Reopen authorization', fr: 'Rouvrir l’autorisation' })
                            : t({ en: 'Open authorization', fr: 'Ouvrir l’autorisation' })}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {fetchingModels && (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <span className="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                {t({ en: 'Fetching models…', fr: 'Récupération des modèles…' })}
              </div>
            )}
            {fetchError && (
              <div className="p-3 rounded-lg text-sm bg-red-500/10 text-red-500 border border-red-500/20">
                <p>{fetchError}</p>
                <p className="text-xs text-text-muted mt-1">
                  {t({ en: 'URL: {{url}}', fr: 'URL : {{url}}' }, { url: formUrl })}
                </p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => fetchModels(formUrl)} className="text-xs text-accent-primary hover:underline">
                    {t({ en: 'Retry', fr: 'Réessayer' })}
                  </button>
                  <button
                    onClick={() => {
                      resetStep2()
                      setFormStep(1)
                    }}
                    className="text-xs text-accent-primary hover:underline"
                  >
                    {t({ en: 'Edit URL', fr: 'Modifier l’URL' })}
                  </button>
                  {!formAuthAdapter && (
                    <button
                      onClick={() => manualModelInputRef.current?.focus()}
                      className="text-xs text-accent-primary hover:underline"
                    >
                      {t({ en: 'Add model manually', fr: 'Ajouter un modèle manuellement' })}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Add model manually — always available in step 2 so providers that
                don't expose a /models endpoint (e.g. Cline) can be configured. */}
            {formBackend && (!formAuthAdapter || providerAuthState === 'connected') && (
              <div>
                <h4 className="text-sm font-medium text-text-primary mb-1">
                  {t({ en: 'Add model manually', fr: 'Ajouter un modèle manuellement' })}
                </h4>
                <p className="text-xs text-text-muted mb-2">
                  {fetchError
                    ? t({
                        en: "Can't discover models automatically? Enter the model name to use:",
                        fr: 'Impossible de détecter les modèles automatiquement ? Saisissez le nom du modèle à utiliser :',
                      })
                    : t({
                        en: 'Enter a model name manually if it does not appear in the list above:',
                        fr: 'Saisissez manuellement un nom de modèle s’il n’apparaît pas dans la liste ci-dessus :',
                      })}
                </p>
                <div className="flex gap-2">
                  <input
                    ref={manualModelInputRef}
                    type="text"
                    value={manualModelId}
                    onChange={(e) => {
                      setManualModelId(e.target.value)
                      if (manualModelError) setManualModelError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addManualModel()
                      }
                    }}
                    placeholder="model-name"
                    data-testid="provider-modal-manual-model-input"
                    className="flex-1 px-3 py-1.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
                  />
                  <button
                    type="button"
                    onClick={addManualModel}
                    data-testid="provider-modal-manual-model-add"
                    className="px-3 py-1.5 bg-accent-primary text-text-primary rounded-lg text-sm font-medium hover:bg-accent-primary/90 transition-colors"
                  >
                    {t({ en: 'Add', fr: 'Ajouter' })}
                  </button>
                </div>
                {manualModelError && <p className="text-xs text-red-500 mt-1">{manualModelError}</p>}
              </div>
            )}

            {models.length > 0 && formBackend && (!formAuthAdapter || providerAuthState === 'connected') && (
              <>
                {/* Selected Models — full config panels */}
                {selectedModelIds.size > 0 && (
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-text-primary mb-1">
                      {t(
                        { en: 'Selected Models ({{count}})', fr: 'Modèles sélectionnés ({{count}})' },
                        { count: selectedModelIds.size },
                      )}
                    </h4>
                    <p className="text-xs text-text-muted mb-2">
                      {t({
                        en: 'Only selected models will appear in the model selector.',
                        fr: 'Seuls les modèles sélectionnés apparaîtront dans le sélecteur de modèle.',
                      })}
                    </p>
                    <div className="space-y-2">
                      {models
                        .filter((m) => selectedModelIds.has(m.id))
                        .map((model) => (
                          <div key={model.id} className="bg-bg-primary border border-border rounded-lg overflow-hidden">
                            <div
                              onClick={() => setExpandedModelId(expandedModelId === model.id ? null : model.id)}
                              className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-tertiary transition-colors cursor-pointer"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-text-primary">
                                  {model.name ?? model.id.split('/').pop()}
                                </span>
                                <span className="text-xs text-text-muted bg-bg-tertiary px-2 py-0.5 rounded flex items-center gap-1">
                                  {(modelConfigs[model.id]?.supportsVision ?? model.supportsVision) && (
                                    <span
                                      data-vision
                                      title={t({ en: 'Vision model', fr: 'Modèle vision' })}
                                      aria-label={t({ en: 'Vision model', fr: 'Modèle vision' })}
                                    >
                                      <EyeIcon className="w-3.5 h-3.5" />
                                    </span>
                                  )}
                                  {t(
                                    { en: '{{n}} ctx', fr: '{{n}} ctx' },
                                    {
                                      n: (modelConfigs[model.id]?.contextWindow ?? model.contextWindow).toLocaleString(
                                        getLocale(),
                                      ),
                                    },
                                  )}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                {autoConfigState.progress[model.id] === 'probing' ? (
                                  <span className="w-3 h-3 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
                                ) : autoConfigState.progress[model.id] === 'done' ? (
                                  <span className="text-xs text-accent-success font-medium">
                                    {t({ en: 'Configured ✓', fr: 'Configuré ✓' })}
                                  </span>
                                ) : autoConfigState.progress[model.id] === 'error' ? (
                                  <span className="text-xs text-red-500 font-medium">
                                    {t({ en: 'Failed ✗', fr: 'Échec ✗' })}
                                  </span>
                                ) : !formAuthAdapter ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      runAutoConfig(model.id)
                                    }}
                                    className="text-xs text-accent-primary hover:underline"
                                  >
                                    {t({ en: 'Auto-config', fr: 'Auto-configuration' })}
                                  </button>
                                ) : null}
                                {models.length > 1 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const next = new Set(selectedModelIds)
                                      next.delete(model.id)
                                      setSelectedModelIds(next)
                                      if (expandedModelId === model.id) setExpandedModelId(null)
                                    }}
                                    className="text-xs text-red-500 hover:text-red-400 px-2 py-1 rounded hover:bg-red-500/10"
                                  >
                                    {t({ en: 'Remove', fr: 'Supprimer' })}
                                  </button>
                                )}
                                <ChevronDownIcon
                                  className={`w-4 h-4 text-text-muted transition-transform ${expandedModelId === model.id ? 'rotate-180' : ''}`}
                                />
                              </div>
                            </div>

                            {expandedModelId === model.id && (
                              <ModelConfigPanel
                                model={model}
                                modelConfigs={modelConfigs}
                                autoConfigState={autoConfigState}
                                testResults={testResults}
                                onUpdateConfig={updateModelConfig}
                                onRunAutoConfig={runAutoConfig}
                                onTestParams={testParams}
                                onShowRaw={setRawModalData}
                              />
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Available Models — search + checkbox list (hidden when single model, already selected) */}
                {models.length > 1 && (
                  <div>
                    <h4 className="text-sm font-medium text-text-primary mb-1">
                      {t({ en: 'Available Models', fr: 'Modèles disponibles' })}
                    </h4>
                    {selectedModelIds.size === 0 && (
                      <p className="text-xs text-text-muted mb-2">
                        {t({
                          en: 'This provider has many models available. Select the ones you want to use below.',
                          fr: 'Ce fournisseur propose de nombreux modèles. Sélectionnez ceux que vous souhaitez utiliser ci-dessous.',
                        })}
                      </p>
                    )}

                    <div className="relative mb-2">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t({ en: 'Search models…', fr: 'Rechercher des modèles…' })}
                        className="w-full px-4 py-2 bg-bg-primary border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-primary"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary text-sm"
                        >
                          &times;
                        </button>
                      )}
                    </div>

                    {mergedModeModels.length > 0 && (
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-text-secondary">
                          {t(
                            {
                              en: {
                                one: '{{count}} model is merged into mode chips:',
                                other: '{{count}} models are merged into mode chips:',
                              },
                              fr: {
                                one: '{{count}} modèle est fusionné dans des pastilles de mode :',
                                other: '{{count}} modèles sont fusionnés dans des pastilles de mode :',
                              },
                            },
                            { count: mergedModeModels.length },
                          )}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {mergedModeModels.map((model) => (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => unmergeModeFamily(model)}
                              className="px-2.5 py-1 rounded border border-border text-text-secondary hover:border-accent-primary/40 hover:text-accent-primary hover:bg-accent-primary/10 transition-colors"
                            >
                              {t(
                                { en: 'Unmerge {{name}} ({{levels}})', fr: 'Dissocier {{name}} ({{levels}})' },
                                {
                                  name: model.name ?? model.id.split('/').pop() ?? '',
                                  levels: model.modes!.map((mode) => mode.level).join(', '),
                                },
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {mergeableGroups.length > 0 && (
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-text-secondary">
                          {t(
                            {
                              en: {
                                one: '{{count}} model group shares the same base name with different modes:',
                                other: '{{count}} model groups share the same base name with different modes:',
                              },
                              fr: {
                                one: '{{count}} groupe de modèles partage le même nom de base avec des modes différents :',
                                other:
                                  '{{count}} groupes de modèles partagent le même nom de base avec des modes différents :',
                              },
                            },
                            { count: mergeableGroups.length },
                          )}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {mergeableGroups.map((group) => (
                            <button
                              key={group.baseId}
                              type="button"
                              onClick={() =>
                                mergeModeFamily(
                                  group.baseId,
                                  group.members
                                    .map((m) => models.find((x) => x.id === m.id))
                                    .filter((m): m is ModelInfo => Boolean(m)),
                                )
                              }
                              className="px-2.5 py-1 rounded border border-accent-primary/40 text-accent-primary hover:bg-accent-primary/10 transition-colors"
                            >
                              {t(
                                { en: 'Merge {{name}}: {{levels}}', fr: 'Fusionner {{name}} : {{levels}}' },
                                {
                                  name: group.baseId.split('/').pop() ?? '',
                                  levels: group.members
                                    .map((m) => splitModeSuffix(m.id)?.level)
                                    .filter(Boolean)
                                    .join(', '),
                                },
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs text-text-muted">
                        {t(
                          {
                            en: 'Showing {{shown}} of {{total}} models',
                            fr: 'Affichage de {{shown}} sur {{total}} modèles',
                          },
                          { shown: filterModels(searchQuery).length, total: models.length },
                        )}
                      </p>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => formUrl && fetchModels(formUrl)}
                          disabled={fetchingModels || !formUrl}
                          className="text-xs text-accent-primary hover:underline flex items-center gap-1 disabled:opacity-50"
                          title={t({
                            en: 'Sync available models from provider',
                            fr: 'Synchroniser les modèles disponibles depuis le fournisseur',
                          })}
                        >
                          <ReloadIcon className={`w-3 h-3 ${fetchingModels ? 'animate-spin' : ''}`} />
                          {t({ en: 'Sync', fr: 'Synchroniser' })}
                        </button>
                        <button
                          onClick={() => {
                            const next = new Set(selectedModelIds)
                            const visible = filterModels(searchQuery)
                            for (const m of visible) next.add(m.id)
                            setSelectedModelIds(next)
                            setModelConfigs((current) => {
                              const updated = { ...current }
                              for (const model of visible) {
                                updated[model.id] = {
                                  contextWindow: model.contextWindow,
                                  ...updated[model.id],
                                }
                              }
                              return updated
                            })
                            if (!formAuthAdapter) {
                              for (const m of visible) {
                                if (
                                  autoConfigState.progress[m.id] !== 'probing' &&
                                  autoConfigState.progress[m.id] !== 'done'
                                ) {
                                  runAutoConfig(m.id)
                                }
                              }
                            }
                          }}
                          className="text-xs text-accent-primary hover:underline"
                        >
                          {t({ en: 'Select all', fr: 'Tout sélectionner' })}
                        </button>
                        <button
                          onClick={() => {
                            const next = new Set(selectedModelIds)
                            const visible = filterModels(searchQuery)
                            for (const m of visible) next.delete(m.id)
                            setSelectedModelIds(next)
                          }}
                          className="text-xs text-text-muted hover:text-text-secondary"
                        >
                          {t({ en: 'Deselect all', fr: 'Tout désélectionner' })}
                        </button>
                      </div>
                    </div>

                    <ScrollArea className="space-y-1 max-h-48 border border-border rounded-lg bg-bg-primary">
                      {filterModels(searchQuery).map((model) => {
                        const isChecked = selectedModelIds.has(model.id)
                        return (
                          <div
                            key={model.id}
                            role="checkbox"
                            aria-checked={isChecked}
                            tabIndex={0}
                            className={`flex items-center gap-3 px-4 py-2 hover:bg-bg-tertiary transition-colors cursor-pointer ${
                              isChecked ? 'bg-accent-primary/5' : ''
                            }`}
                            onClick={() => {
                              if (isChecked) {
                                const next = new Set(selectedModelIds)
                                next.delete(model.id)
                                setSelectedModelIds(next)
                              } else {
                                selectModel(model)
                                if (!formAuthAdapter) runAutoConfig(model.id)
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                e.currentTarget.click()
                              }
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="w-4 h-4 rounded border-border accent-accent-primary pointer-events-none"
                            />
                            <span className="text-sm text-text-primary flex-1 truncate">
                              {model.name ?? model.id.split('/').pop()}
                              {model.modes && model.modes.length > 0 && (
                                <span className="text-text-muted font-normal ml-1">
                                  ({model.modes.map((m) => m.level).join(', ')})
                                </span>
                              )}
                            </span>
                            <span className="text-xs text-text-muted flex flex-shrink-0 items-center gap-1">
                              {(modelConfigs[model.id]?.supportsVision ?? model.supportsVision) && (
                                <span
                                  data-vision
                                  title={t({ en: 'Vision model', fr: 'Modèle vision' })}
                                  aria-label={t({ en: 'Vision model', fr: 'Modèle vision' })}
                                >
                                  <EyeIcon className="w-3.5 h-3.5" />
                                </span>
                              )}
                              {t(
                                { en: '{{n}} ctx', fr: '{{n}} ctx' },
                                {
                                  n: (modelConfigs[model.id]?.contextWindow ?? model.contextWindow).toLocaleString(
                                    getLocale(),
                                  ),
                                },
                              )}
                            </span>
                            {autoConfigState.progress[model.id] === 'probing' && (
                              <span className="w-3 h-3 border-2 border-accent-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
                            )}
                            {autoConfigState.progress[model.id] === 'done' && (
                              <span className="text-xs text-accent-success flex-shrink-0">✓</span>
                            )}
                            {autoConfigState.progress[model.id] === 'error' && (
                              <span className="text-xs text-red-500 flex-shrink-0">✗</span>
                            )}
                          </div>
                        )
                      })}
                      {filterModels(searchQuery).length === 0 && (
                        <div className="px-4 py-6 text-center text-sm text-text-muted">
                          {t(
                            { en: 'No models match “{{query}}”', fr: 'Aucun modèle ne correspond à « {{query}} »' },
                            { query: searchQuery },
                          )}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Provider defaults modal */}
      {showDefaults && (
        <Modal
          isOpen
          onClose={() => setShowDefaults(false)}
          title={t({ en: 'Provider-Level Defaults', fr: 'Valeurs par défaut du fournisseur' })}
          size="md"
          footer={
            <div className="flex justify-end">
              <button
                onClick={() => setShowDefaults(false)}
                className="px-5 py-2 bg-accent-primary text-text-primary rounded-lg text-sm font-medium hover:bg-accent-primary/90 transition-colors"
              >
                {t({ en: 'Done', fr: 'Terminé' })}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-text-muted">
              {t({
                en: 'Thinking and reasoning effort are configured per model, in each model’s Advanced section.',
                fr: 'La réflexion et le niveau de raisonnement sont configurés par modèle, dans la section Avancé de chaque modèle.',
              })}
            </p>
            <div>
              <label className="text-xs text-text-secondary block mb-1">
                {t({ en: 'Thinking response field', fr: 'Champ de réponse de réflexion' })}{' '}
                <span className="text-text-muted">{t({ en: '(override)', fr: '(remplacement)' })}</span>
              </label>
              <input
                type="text"
                aria-label={t({ en: 'Thinking response field', fr: 'Champ de réponse de réflexion' })}
                value={thinkingField}
                onChange={(e) => setThinkingField(e.target.value)}
                placeholder={t({ en: 'Leave blank for auto-detect', fr: 'Laissez vide pour la détection automatique' })}
                className="w-full px-3 py-2 bg-bg-primary border border-border rounded text-sm text-text-primary font-mono"
              />
              <p className="text-xs text-text-muted mt-1">
                {t({
                  en: 'Field name the backend uses for reasoning/thinking content (e.g. reasoning, reasoning_content, thinking).',
                  fr: 'Nom du champ que le backend utilise pour le contenu de raisonnement/réflexion (ex. reasoning, reasoning_content, thinking).',
                })}
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sendReasoningInMessages}
                onChange={(e) => setSendReasoningInMessages(e.target.checked)}
                className="rounded border-border bg-bg-primary text-accent-primary focus:ring-accent-primary"
              />
              <span className="text-sm text-text-secondary">
                {t({ en: 'Send reasoning in messages', fr: 'Envoyer le raisonnement dans les messages' })}
              </span>
              <span className="text-xs text-text-muted ml-auto">
                {t({
                  en: 'When disabled, strips reasoning/thinking content from assistant messages sent to this provider',
                  fr: 'Lorsqu’il est désactivé, supprime le contenu de raisonnement/réflexion des messages d’assistant envoyés à ce fournisseur',
                })}
              </span>
            </label>
          </div>
        </Modal>
      )}

      {/* Raw response modal */}
      {rawModalData && (
        <Modal
          isOpen
          onClose={() => setRawModalData(null)}
          title={t({ en: 'Raw Response', fr: 'Réponse brute' })}
          size="lg"
        >
          <ScrollArea horizontal>
            <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all">{rawModalData}</pre>
          </ScrollArea>
        </Modal>
      )}
    </>
  )
}
