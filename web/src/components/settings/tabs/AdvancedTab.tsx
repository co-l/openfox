import { useEffect, useState, useCallback } from 'react'
import { useLocation } from 'wouter'
import { authFetch } from '../../../lib/api'
import { useT } from '../../../hooks/useT'
import { Button } from '../../shared/Button'
import { Input } from '../../shared/Input'
import { Toggle } from '../../shared/Toggle'
import { SETTINGS_KEYS, setSetting } from '../../../lib/resources'
import { useSetting } from '../../../hooks/useSetting'
import { useTestButton } from '../../../hooks/useTestButton'
import { RetryPatternsEditor, type RetryPatternsValue } from '../RetryPatternsEditor'
import { useConfig } from '../../../hooks/useConfig'
import { useUpdateStore } from '../../../stores/update'
import { AutoUpdateModal } from '../../AutoUpdateModal'
import { ChangelogModal } from '../../ChangelogModal'
import { useAgents } from '../../../hooks/useAgents'
import { useWorkflows } from '../../../hooks/useWorkflows'
import { SCOPE_LABELS } from '../../../lib/workflow-scope'

export function AdvancedTab({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [, navigate] = useLocation()
  const showOpenInEditor = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR).value === 'true'
  const dynamicSystemPrompt = useSetting(SETTINGS_KEYS.LLM_DYNAMIC_SYSTEM_PROMPT).value === 'true'
  const cacheWarming = useSetting(SETTINGS_KEYS.CACHE_WARMING).value === 'true'
  const retryPatternsSetting = useSetting(SETTINGS_KEYS.RETRY_PATTERNS).value
  const proxyUrlSetting = useSetting(SETTINGS_KEYS.PROXY_URL).value
  const defaultAgentSetting = useSetting(SETTINGS_KEYS.DEFAULT_AGENT).value
  const favoriteWorkflowSetting = useSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW).value
  const autoAnswerSetting = useSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS, 'false').value
  const autoActionTimeoutSetting = useSetting(SETTINGS_KEYS.AUTO_ACTION_TIMEOUT, '90').value
  const autoActionSeconds = /^\d+$/.test(autoActionTimeoutSetting) ? autoActionTimeoutSetting : '90'
  const { workflows: allWorkflows } = useWorkflows()
  // Global favorite may only reference global scopes (builtin + user): a
  // project-scoped workflow must never be picked as the system-wide default.
  const globalWorkflows = allWorkflows.filter((w) => w.scope !== 'project')
  const currentFavoriteWorkflowMissing =
    !!favoriteWorkflowSetting && !globalWorkflows.some((w) => w.id === favoriteWorkflowSetting)
  // The timeout only concerns the two automatic behaviors: show it once one of
  // them is configured away from its default (off).
  const showAutoActionTimeout = !!favoriteWorkflowSetting || autoAnswerSetting === 'true'
  const showChangelogSetting = useSetting(SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE, 'true').value

  const [localToggles, setLocalToggles] = useState({
    openInEditor: showOpenInEditor,
    dynamicPrompt: dynamicSystemPrompt,
    cacheWarming,
  })

  const [retryPatterns, setRetryPatterns] = useState<RetryPatternsValue>({ patterns: [], maxRetriesPerTurn: 10 })
  const [proxyUrl, setProxyUrl] = useState('')
  const [autoActionTimeout, setAutoActionTimeout] = useState(autoActionTimeoutSetting)
  const [defaultAgent, setDefaultAgent] = useState('')
  const [defaultAgentLoaded, setDefaultAgentLoaded] = useState(false)
  const [proxyTestText, proxyTestError, proxyTestSuccess, testProxy] = useTestButton()
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [showChangelogModal, setShowChangelogModal] = useState(false)
  const version = useConfig().config?.version ?? null
  const updateStatus = useUpdateStore((state) => state.status)
  const latestVersion = useUpdateStore((state) => state.latest)
  const checkForUpdate = useUpdateStore((state) => state.check)
  const versionInfo = version && latestVersion ? { current: version, latest: latestVersion } : null
  // "Up to date" only answers a manual check; the background check on app
  // load may be hours old by the time this tab is opened.
  const [manuallyChecked, setManuallyChecked] = useState(false)
  const { agents } = useAgents()
  const topLevelAgents = agents.filter((a) => !a.subagent)

  useEffect(() => {
    setLocalToggles({
      openInEditor: showOpenInEditor,
      dynamicPrompt: dynamicSystemPrompt,
      cacheWarming,
    })
  }, [showOpenInEditor, dynamicSystemPrompt, cacheWarming])

  useEffect(() => {
    if (retryPatternsSetting) {
      try {
        setRetryPatterns(JSON.parse(retryPatternsSetting))
      } catch {
        // ignore parse errors
      }
    }
  }, [retryPatternsSetting])

  useEffect(() => {
    if (proxyUrlSetting !== '') {
      setProxyUrl(proxyUrlSetting)
    }
  }, [proxyUrlSetting])

  useEffect(() => {
    if (autoActionTimeoutSetting !== '') {
      setAutoActionTimeout(autoActionTimeoutSetting)
    }
  }, [autoActionTimeoutSetting])

  useEffect(() => {
    if (defaultAgentSetting !== '') {
      setDefaultAgent(defaultAgentSetting)
      setDefaultAgentLoaded(true)
    }
  }, [defaultAgentSetting])

  const handleRetryPatternsChange = useCallback((value: RetryPatternsValue) => {
    setRetryPatterns(value)
    void setSetting(SETTINGS_KEYS.RETRY_PATTERNS, JSON.stringify(value))
  }, [])

  const handleProxyUrlChange = (value: string) => {
    setProxyUrl(value)
    void setSetting(SETTINGS_KEYS.PROXY_URL, value)
  }

  const handleAutoActionTimeoutChange = (value: string) => {
    setAutoActionTimeout(value)
    if (/^\d+$/.test(value) && Number(value) >= 1) {
      void setSetting(SETTINGS_KEYS.AUTO_ACTION_TIMEOUT, value)
    }
  }

  function handleTestProxy() {
    testProxy(async () => {
      const res = await authFetch('/api/proxy/test', { method: 'POST' })
      return res.json()
    })
  }

  const handleToggleOpenInEditor = () => {
    const newValue = !localToggles.openInEditor
    setLocalToggles((prev) => ({ ...prev, openInEditor: newValue }))
    void setSetting(SETTINGS_KEYS.DISPLAY_SHOW_OPEN_IN_EDITOR, String(newValue))
  }

  const handleToggleDynamicSystemPrompt = () => {
    const newValue = !localToggles.dynamicPrompt
    setLocalToggles((prev) => ({ ...prev, dynamicPrompt: newValue }))
    void setSetting(SETTINGS_KEYS.LLM_DYNAMIC_SYSTEM_PROMPT, String(newValue))
  }

  const handleToggleCacheWarming = () => {
    const newValue = !localToggles.cacheWarming
    setLocalToggles((prev) => ({ ...prev, cacheWarming: newValue }))
    void setSetting(SETTINGS_KEYS.CACHE_WARMING, String(newValue))
  }

  function handleLaunchOnboarding() {
    onClose()
    navigate('/onboarding')
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">
          {updateStatus === 'available' && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-primary mr-1.5 align-middle" />
          )}
          {t({ en: 'Updates', fr: 'Mises à jour' })}
        </h3>
        <p className="text-sm text-text-muted mb-4">
          {version ? (
            <>
              {t({ en: 'Current version:', fr: 'Version actuelle :' })}{' '}
              <span className="font-mono">{`v${version}`}</span>
            </>
          ) : (
            t({
              en: 'Check for a new OpenFox version.',
              fr: 'Vérifiez si une nouvelle version d’OpenFox est disponible.',
            })
          )}
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setManuallyChecked(true)
              checkForUpdate()
            }}
            disabled={updateStatus === 'checking'}
          >
            {updateStatus === 'checking'
              ? t({ en: 'Checking…', fr: 'Vérification…' })
              : t({ en: 'Check for Updates', fr: 'Vérifier les mises à jour' })}
          </Button>
          {manuallyChecked && updateStatus === 'upToDate' && (
            <span className="text-sm text-text-muted">{t({ en: 'Up to date', fr: 'À jour' })}</span>
          )}
          {updateStatus === 'error' && (
            <span className="text-sm text-text-muted">
              {t({ en: 'Update check failed', fr: 'Échec de la vérification des mises à jour' })}
            </span>
          )}
          {updateStatus === 'available' && (
            <button onClick={() => setShowUpdateModal(true)} className="text-sm text-accent-primary hover:underline">
              {t(
                { en: 'Update to v{{version}} →', fr: 'Mettre à jour vers la v{{version}} →' },
                { version: latestVersion ?? '' },
              )}
            </button>
          )}
        </div>
      </div>
      <AutoUpdateModal isOpen={showUpdateModal} onClose={() => setShowUpdateModal(false)} versionInfo={versionInfo} />
      <div className="flex items-center justify-between pt-2">
        <button onClick={() => setShowChangelogModal(true)} className="text-sm text-accent-primary hover:underline">
          {t({ en: 'View Changelog →', fr: 'Voir le journal →' })}
        </button>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-text-muted">
            {t({ en: 'Show on update', fr: 'Afficher lors des mises à jour' })}
          </span>
          <Toggle
            enabled={showChangelogSetting === 'true'}
            onClick={() => {
              const newValue = showChangelogSetting === 'true' ? 'false' : 'true'
              void setSetting(SETTINGS_KEYS.DISPLAY_SHOW_CHANGELOG_ON_UPDATE, newValue)
            }}
          />
        </label>
      </div>
      <ChangelogModal isOpen={showChangelogModal} onClose={() => setShowChangelogModal(false)} />
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">
          {t({ en: 'Default Agent', fr: 'Agent par défaut' })}
        </h3>
        <p className="text-sm text-text-muted mb-3">
          {t({
            en: 'Choose which agent is used by default for new sessions. The stock Planner is read-only; custom agents can have broader capabilities.',
            fr: 'Choisissez l’agent utilisé par défaut pour les nouvelles sessions. Le Planner standard est en lecture seule ; les agents personnalisés peuvent avoir des capacités plus étendues.',
          })}
        </p>
        <select
          value={defaultAgentLoaded ? defaultAgent : ''}
          onChange={(e) => {
            const val = e.target.value
            setDefaultAgent(val)
            void setSetting(SETTINGS_KEYS.DEFAULT_AGENT, val)
          }}
          className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
        >
          {!defaultAgentLoaded && <option value="">{t({ en: 'Loading…', fr: 'Chargement…' })}</option>}
          {defaultAgentLoaded && (
            <option value="">{t({ en: 'System default (planner)', fr: 'Défaut système (planner)' })}</option>
          )}
          {topLevelAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        {topLevelAgents.length === 0 && defaultAgentLoaded && (
          <p className="text-xs text-text-muted mt-1">
            {t({
              en: 'No agents available. Create one in the Agents modal.',
              fr: 'Aucun agent disponible. Créez-en un dans la fenêtre des agents.',
            })}
          </p>
        )}
      </div>
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">
          {t({ en: 'Favorite Workflow', fr: 'Workflow favori' })}
        </h3>
        <p className="text-sm text-text-muted mb-3">
          {t(
            {
              en: 'When a task finishes planning, the favorite workflow auto-launches after a {{seconds}}s countdown instead of waiting for you to choose. Leave empty to always pick manually. Local workflows can only be picked at project level.',
              fr: 'Quand une tâche termine son plan, le workflow favori se lance automatiquement après un compte à rebours de {{seconds}} s au lieu d’attendre votre choix. Laissez vide pour choisir manuellement. Les workflows locaux ne peuvent être choisis qu’au niveau du projet.',
            },
            { seconds: autoActionSeconds },
          )}
        </p>
        <select
          value={favoriteWorkflowSetting ?? ''}
          onChange={(e) => void setSetting(SETTINGS_KEYS.FAVORITE_WORKFLOW, e.target.value)}
          className="w-full px-3 py-2 text-sm bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
        >
          <option value="">{t({ en: 'No favorite (choose manually)', fr: 'Aucun favori (choix manuel)' })}</option>
          {currentFavoriteWorkflowMissing && (
            <option value={favoriteWorkflowSetting}>
              {favoriteWorkflowSetting} {t({ en: '(missing workflow)', fr: '(workflow manquant)' })}
            </option>
          )}
          {globalWorkflows.map((w) => (
            <option key={`${w.id}-${w.scope}`} value={w.id}>
              {w.name} — {SCOPE_LABELS[w.scope]}
            </option>
          ))}
        </select>
        {currentFavoriteWorkflowMissing && (
          <p className="text-xs text-red-400 mt-1">
            {t(
              {
                en: 'The stored favorite workflow "{{workflow}}" no longer exists. Pick another workflow to restore a valid favorite.',
                fr: 'Le workflow favori enregistré « {{workflow}} » n’existe plus. Choisissez un autre workflow pour restaurer un favori valide.',
              },
              { workflow: favoriteWorkflowSetting ?? '' },
            )}
          </p>
        )}
      </div>
      <hr className="border-border" />
      <SettingsToggle
        title={t({ en: 'Auto-answer agent questions', fr: 'Réponse automatique aux questions de l’agent' })}
        description={t(
          {
            en: 'When the agent asks a choice or confirmation question, the recommended answer (the first option, or "Yes") is applied automatically after a {{seconds}}s countdown. Cancel it by answering, or by starting to type. Free-text questions are disabled while this mode is on.',
            fr: 'Quand l’agent pose une question à choix ou de confirmation, la réponse recommandée (la première option, ou « Oui ») est appliquée automatiquement après un compte à rebours de {{seconds}} s. Annulez-la en répondant ou en commençant à saisir. Les questions texte libres sont désactivées quand ce mode est activé.',
          },
          { seconds: autoActionSeconds },
        )}
        enabled={autoAnswerSetting === 'true'}
        onToggle={() =>
          void setSetting(SETTINGS_KEYS.AUTO_ANSWER_QUESTIONS, autoAnswerSetting === 'true' ? 'false' : 'true')
        }
      />
      {showAutoActionTimeout && (
        <>
          <hr className="border-border" />
          <div>
            <label htmlFor="auto-action-timeout" className="text-xs text-text-secondary block mb-1">
              {t({ en: 'Automatic actions timeout (seconds)', fr: 'Timeout des actions automatiques (secondes)' })}
            </label>
            <p className="text-sm text-text-muted mb-2">
              {t({
                en: 'Duration of the favorite-workflow auto-launch and auto-answer countdowns. Default 90.',
                fr: 'Durée des comptes à rebours de lancement automatique du workflow favori et de réponse automatique. Par défaut 90.',
              })}
            </p>
            <Input
              id="auto-action-timeout"
              type="number"
              min={1}
              step={1}
              value={autoActionTimeout}
              onChange={(e) => handleAutoActionTimeoutChange(e.target.value)}
              className="w-32"
            />
          </div>
        </>
      )}
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-1">{t({ en: 'Onboarding', fr: 'Prise en main' })}</h3>
        <p className="text-sm text-text-muted mb-4">
          {t({
            en: 'Manage providers, workdir and vision fallback.',
            fr: 'Gérez les fournisseurs, le dossier de travail et le fallback vision.',
          })}
        </p>
        <Button variant="secondary" onClick={handleLaunchOnboarding}>
          {t({ en: 'Launch Onboarding', fr: 'Lancer la prise en main' })}
        </Button>
      </div>
      <hr className="border-border" />
      <div>
        <SettingsToggle
          title={t({ en: 'Show "Open in VSCode" links', fr: 'Afficher les liens « Ouvrir dans VSCode »' })}
          description={t({
            en: 'Display a link on file reads to open the file directly in VS Code.',
            fr: 'Affiche un lien sur les lectures de fichiers pour ouvrir le fichier directement dans VS Code.',
          })}
          enabled={localToggles.openInEditor}
          onToggle={handleToggleOpenInEditor}
        />
      </div>
      <hr className="border-border" />
      <SettingsToggle
        title={t({ en: 'Speculative Cache Warming', fr: 'Préchauffage spéculatif du cache' })}
        description={t({
          en: 'On first keystroke in an empty session, prefill the LLM KV cache to reduce time-to-first-token.',
          fr: 'Au premier caractère saisi dans une session vide, préremplit le cache KV du LLM pour réduire le délai avant le premier jeton.',
        })}
        enabled={localToggles.cacheWarming}
        onToggle={handleToggleCacheWarming}
        boldTitle
      />
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">{t({ en: 'Network', fr: 'Réseau' })}</h3>
        <div>
          <label className="text-xs text-text-secondary block mb-1">{t({ en: 'HTTP Proxy', fr: 'Proxy HTTP' })}</label>
          <div className="flex gap-2 items-center">
            <Input
              type="text"
              value={proxyUrl}
              onChange={(e) => handleProxyUrlChange(e.target.value)}
              placeholder="http://proxy:8080"
              className="flex-1"
            />
            <Button
              variant="secondary"
              onClick={handleTestProxy}
              style={proxyTestSuccess ? { color: 'rgb(63, 185, 80)' } : undefined}
            >
              {proxyTestText}
            </Button>
          </div>
          {proxyTestError && <p className="text-xs text-red-500 mt-1">{proxyTestError}</p>}
          <p className="text-xs text-text-muted mt-1">
            {t({
              en: 'Proxy server all OpenFox network requests (AI, model fetching, web search, terminal). Leave empty for direct connection.',
              fr: 'Passe toutes les requêtes réseau d’OpenFox par le serveur proxy (IA, téléchargement de modèles, recherche web, terminal). Laissez vide pour une connexion directe.',
            })}
          </p>
        </div>
      </div>
      <hr className="border-border" />
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">
          {t({ en: 'Auto-Retry Patterns', fr: 'Modèles de nouvelle tentative automatique' })}
        </h3>
        <p className="text-sm text-text-muted mb-3">
          {t({
            en: 'Define regex patterns that, when matched against LLM responses mid-stream, trigger an automatic retry with a "continue" prompt. The content that triggered the match is preserved in the chat feed.',
            fr: 'Définissez des motifs regex qui, lorsqu’ils correspondent aux réponses du LLM en cours de diffusion, déclenchent une nouvelle tentative automatique avec une invite « continue ». Le contenu ayant déclenché la correspondance est conservé dans le fil.',
          })}
        </p>
        <RetryPatternsEditor value={retryPatterns} onChange={handleRetryPatternsChange} />
      </div>
      <hr className="border-border" />
      <SettingsToggle
        title={t({ en: 'Dynamic System Prompt', fr: 'Prompt système dynamique' })}
        description={t({
          en: 'Rebuild the system prompt on every turn. Recommended value: off.',
          fr: 'Reconstruit le prompt système à chaque tour. Valeur recommandée : désactivé.',
        })}
        enabled={localToggles.dynamicPrompt}
        onToggle={handleToggleDynamicSystemPrompt}
        boldTitle
      />
    </div>
  )
}

function SettingsToggle({
  title,
  description,
  enabled,
  onToggle,
  boldTitle,
}: {
  title: string
  description: string
  enabled: boolean
  onToggle: () => void
  boldTitle?: boolean
}) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer">
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${boldTitle ? 'font-medium' : ''} text-text-primary`}>{title}</div>
        <div className="text-sm text-text-muted mt-0.5">{description}</div>
      </div>
      <div className="flex-shrink-0">
        <Toggle enabled={enabled} onClick={onToggle} />
      </div>
    </label>
  )
}
