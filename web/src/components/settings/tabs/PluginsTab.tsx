import { useState } from 'react'
import type { ReactNode } from 'react'
import { useT } from '../../../hooks/useT'
import { useLocalizedString } from '../../../hooks/useLocalizedString'
import { usePlugins } from '../../../hooks/usePlugins'
import { useResource } from '../../../hooks/useResource'
import { pluginRegistryResource, pluginDiagnosticsResource } from '../../../lib/resources'
import { installPlugin, reinstallPlugin, setPluginEnabled, uninstallPlugin } from '../../../lib/plugin-actions'
import { authFetch } from '../../../lib/api'
import { Button } from '../../shared/Button'
import { Toggle } from '../../shared/Toggle'
import { ConfirmModal } from '../../shared/ConfirmModal'
import { PluginSettingsForm } from '../../plugins/PluginSettingsForm'
import { PluginLogo } from '../../shared/PluginLogo'
import type { PluginContributionSummary, PluginInfo } from '@shared/plugin.js'

interface RegistryPlugin {
  name: string
  displayName: string
  description: string
  githubUrl: string
  author?: string
  icon?: string
  logo?: string
}

function getDeveloperName(author?: string, githubUrl?: string): string | undefined {
  if (author && author.trim()) return author.trim()
  if (githubUrl) {
    const match = githubUrl.match(/github\.com\/([^/]+)/)
    if (match?.[1]) return match[1]
  }
  return undefined
}

const CAPABILITY_ORDER = [
  'providers',
  'models',
  'settings',
  'tools',
  'commands',
  'skills',
  'ui',
  'hooks',
  'notifications',
  'workflows',
  'rpc',
  'assets',
  'transforms',
  'dangerLevels',
] as const

function contributionSummaryParts(summary: PluginContributionSummary): { key: string; count: number }[] {
  return [
    { key: 'tools', count: summary.tools },
    { key: 'commands', count: summary.commands },
    { key: 'skills', count: summary.skillSources },
    { key: 'actions', count: summary.uiActions },
    { key: 'badges', count: summary.uiBadges },
    { key: 'panels', count: summary.uiPanels },
    { key: 'hooks', count: summary.hooks },
    { key: 'rpc', count: summary.rpcMethods },
    { key: 'settings', count: summary.settingsFields },
    { key: 'presets', count: summary.presets },
    { key: 'transitions', count: summary.transitions },
    { key: 'transforms', count: summary.messageTransforms },
    { key: 'dangerLevels', count: summary.dangerLevels },
  ].filter((entry) => entry.count > 0)
}

function PluginTitle({
  title,
  subtitle,
  icon,
  logo,
  children,
}: {
  title: string
  subtitle: string
  icon?: string
  logo?: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <PluginLogo icon={icon} logo={logo} className="w-5 h-5" />
      <h3 className="text-sm font-medium text-text-primary">{title}</h3>
      <span className="text-xs text-text-muted">{subtitle}</span>
      {children}
    </div>
  )
}

function PluginDescription({ description }: { description?: string }) {
  if (!description) return null
  return (
    <div
      className="text-xs text-text-muted mt-1 whitespace-pre-line leading-relaxed"
      dangerouslySetInnerHTML={{ __html: description }}
    />
  )
}

function PluginCardLayout({
  header,
  right,
  footer,
  children,
}: {
  header: ReactNode
  right: ReactNode
  footer?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="border border-border rounded-lg p-4 flex flex-col justify-between">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">{header}</div>
        {right}
      </div>
      {footer ? <div className="flex items-center justify-between gap-2 pt-2 mt-1">{footer}</div> : null}
      {children}
    </div>
  )
}

function InstalledPluginCard({ plugin }: { plugin: PluginInfo }) {
  const t = useT()
  const localize = useLocalizedString()
  const { contributions, refresh } = usePlugins()
  const { data: registry } = useResource(pluginRegistryResource)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const section = contributions.sections.find((candidate) => candidate.pluginId === plugin.id)
  const registryEntry = (registry?.plugins ?? []).find((candidate) => candidate.name === plugin.id)
  const developer = getDeveloperName(plugin.author, registryEntry?.githubUrl)
  const statusLabel = plugin.error
    ? t({ en: 'Error', fr: 'Erreur' })
    : plugin.enabled
      ? t({ en: 'Loaded', fr: 'Chargé' })
      : t({ en: 'Disabled', fr: 'Désactivé' })
  const statusClass = plugin.error
    ? 'text-accent-error border-accent-error/40'
    : plugin.enabled
      ? 'text-accent-success border-accent-success/40'
      : 'text-text-muted border-border'
  const parts = contributionSummaryParts(plugin.contributions)

  const toggleEnabled = async (enabled: boolean) => {
    setBusy(true)
    setError(null)
    const result = await setPluginEnabled(plugin.id, enabled)
    if (!result.ok)
      setError(result.error ?? t({ en: 'Failed to update plugin', fr: 'Échec de la mise à jour du plugin' }))
    await refresh()
    setBusy(false)
  }

  const reinstall = async () => {
    setBusy(true)
    setError(null)
    const result = await reinstallPlugin(plugin.id)
    if (!result.ok) setError(result.error ?? t({ en: 'Reinstall failed', fr: 'Échec de la réinstallation' }))
    await refresh()
    setBusy(false)
  }

  const openFolder = async () => {
    setError(null)
    const res = await authFetch(`/api/plugins/${encodeURIComponent(plugin.id)}/open-folder`).catch(() => null)
    if (!res || !res.ok) {
      setError(t({ en: 'Could not open the plugin folder', fr: 'Impossible d’ouvrir le dossier du plugin' }))
    }
  }

  const remove = async () => {
    setBusy(true)
    const result = await uninstallPlugin(plugin.id)
    if (!result.ok)
      setError(result.error ?? t({ en: 'Failed to remove plugin', fr: 'Échec de la suppression du plugin' }))
    await refresh()
    setBusy(false)
    setConfirmRemove(false)
  }

  return (
    <PluginCardLayout
      header={
        <>
          <PluginTitle title={plugin.displayName} subtitle={plugin.id} icon={plugin.icon} logo={plugin.logo}>
            <span className="text-xs text-text-muted">{`v${plugin.version}`}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusClass}`}>{statusLabel}</span>
            <span className="text-[10px] text-text-muted">{`API v${plugin.apiVersion}`}</span>
          </PluginTitle>
          <PluginDescription description={plugin.description} />
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {CAPABILITY_ORDER.filter((capability) => plugin.capabilities.includes(capability)).map((capability) => (
              <span
                key={capability}
                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-secondary border border-border"
              >
                {capability}
              </span>
            ))}
          </div>
          {plugin.error ? <p className="text-xs text-accent-error mt-2">{plugin.error}</p> : null}
          {error ? <p className="text-xs text-accent-error mt-2">{error}</p> : null}
        </>
      }
      right={
        <div className="flex flex-col items-end gap-2">
          <Toggle enabled={plugin.enabled} disabled={busy} onClick={() => void toggleEnabled(!plugin.enabled)} />
          <div className="flex gap-1">
            {section ? (
              <Button variant="secondary" size="sm" onClick={() => setShowSettings((open) => !open)}>
                {t({ en: 'Settings', fr: 'Paramètres' })}
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void reinstall()}>
              {t({ en: 'Reinstall', fr: 'Réinstaller' })}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void openFolder()}>
              {t({ en: 'Open folder', fr: 'Ouvrir le dossier' })}
            </Button>
            {plugin.removable ? (
              <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirmRemove(true)}>
                {t({ en: 'Remove', fr: 'Supprimer' })}
              </Button>
            ) : (
              <span className="text-[10px] text-text-muted self-center max-w-[9rem] text-right">
                {t({ en: 'Managed outside OpenFox', fr: 'Géré hors d’OpenFox' })}
              </span>
            )}
          </div>
        </div>
      }
      footer={
        parts.length > 0 || developer ? (
          <>
            {parts.length > 0 ? (
              <span className="text-xs text-text-muted">
                {parts.map((part) => `${part.count} ${part.key}`).join(' · ')}
              </span>
            ) : (
              <span />
            )}
            {developer ? (
              <span className="text-xs text-text-muted ml-auto">
                {t({ en: 'by {{author}}', fr: 'par {{author}}' }, { author: developer })}
              </span>
            ) : null}
          </>
        ) : null
      }
    >
      {showSettings && section ? (
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="text-xs font-medium text-text-secondary mb-3">{localize(section.title)}</h4>
          <PluginSettingsForm pluginId={plugin.id} hideScopeSelector />
        </div>
      ) : null}
      <ConfirmModal
        isOpen={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={() => void remove()}
        title={t({ en: 'Remove "{{name}}"?', fr: 'Supprimer « {{name}} » ?' }, { name: plugin.displayName })}
        message={t({
          en: 'The plugin files will be deleted from your installation.',
          fr: 'Les fichiers du plugin seront supprimés de votre installation.',
        })}
      />
    </PluginCardLayout>
  )
}

function RegistryPluginCard({ plugin, installed }: { plugin: RegistryPlugin; installed: boolean }) {
  const t = useT()
  const { refresh } = usePlugins()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const developer = getDeveloperName(plugin.author, plugin.githubUrl)

  const install = async () => {
    setBusy(true)
    setError(null)
    const result = await installPlugin({ githubUrl: plugin.githubUrl })
    if (!result.ok) setError(result.error ?? t({ en: 'Install failed', fr: 'Échec de l’installation' }))
    await refresh()
    setBusy(false)
  }

  return (
    <PluginCardLayout
      header={
        <>
          <PluginTitle title={plugin.displayName} subtitle={plugin.name} icon={plugin.icon} logo={plugin.logo} />
          <PluginDescription description={plugin.description} />
          <a
            href={plugin.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent-primary hover:underline"
          >
            {t({ en: 'Source repository', fr: 'Dépôt source' })}
          </a>
          {error ? <p className="text-xs text-accent-error mt-1">{error}</p> : null}
        </>
      }
      right={
        <Button
          variant={installed ? 'secondary' : 'primary'}
          size="sm"
          disabled={busy || installed}
          onClick={() => void install()}
        >
          {installed
            ? t({ en: 'Installed', fr: 'Installé' })
            : busy
              ? t({ en: 'Installing…', fr: 'Installation…' })
              : t({ en: 'Install', fr: 'Installer' })}
        </Button>
      }
      footer={
        developer ? (
          <span className="text-xs text-text-muted ml-auto">
            {t({ en: 'by {{author}}', fr: 'par {{author}}' }, { author: developer })}
          </span>
        ) : null
      }
    />
  )
}

type InstallMode = 'github' | 'npm' | 'path'

const INSTALL_PLACEHOLDERS: Record<InstallMode, { en: string; fr: string }> = {
  github: {
    en: 'https://github.com/user/openfox-plugin',
    fr: 'https://github.com/utilisateur/openfox-plugin',
  },
  npm: { en: 'openfox-my-plugin', fr: 'openfox-mon-plugin' },
  path: { en: '/home/user/openfox-plugin', fr: '/home/utilisateur/openfox-plugin' },
}

function InstallFromInput() {
  const t = useT()
  const { refresh } = usePlugins()
  const [mode, setMode] = useState<InstallMode>('github')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const install = async () => {
    const trimmed = value.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    const input = mode === 'github' ? { githubUrl: trimmed } : mode === 'npm' ? { npm: trimmed } : { path: trimmed }
    const result = await installPlugin(input)
    if (!result.ok) setError(result.error ?? t({ en: 'Install failed', fr: 'Échec de l’installation' }))
    else setValue('')
    await refresh()
    setBusy(false)
  }

  return (
    <div>
      <label className="block text-xs text-text-secondary mb-1" htmlFor="plugin-install-mode">
        {t({ en: 'Install source', fr: 'Source d’installation' })}
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          id="plugin-install-mode"
          value={mode}
          onChange={(event) => setMode(event.target.value as InstallMode)}
          className="px-2 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded"
        >
          <option value="github">{t({ en: 'GitHub URL', fr: 'URL GitHub' })}</option>
          <option value="npm">{t({ en: 'npm package', fr: 'Paquet npm' })}</option>
          <option value="path">{t({ en: 'Local path', fr: 'Chemin local' })}</option>
        </select>
        <input
          id="plugin-install-input"
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t(INSTALL_PLACEHOLDERS[mode])}
          className="flex-1 px-2 py-1.5 text-sm text-text-primary bg-bg-tertiary border border-border rounded"
        />
        <Button variant="primary" size="sm" disabled={busy || !value.trim()} onClick={() => void install()}>
          {busy ? t({ en: 'Installing…', fr: 'Installation…' }) : t({ en: 'Install', fr: 'Installer' })}
        </Button>
      </div>
      {error ? <p className="text-xs text-accent-error mt-1">{error}</p> : null}
    </div>
  )
}

function PluginDiagnosticsSection() {
  const t = useT()
  const { data } = useResource(pluginDiagnosticsResource)
  const failed = (data?.diagnostics ?? []).filter((diagnostic) => !diagnostic.loaded || diagnostic.error)
  if (failed.length === 0) return null

  return (
    <section>
      <h2 className="text-sm font-medium text-text-primary mb-3">{t({ en: 'Diagnostics', fr: 'Diagnostics' })}</h2>
      <div className="flex flex-col gap-2">
        {failed.map((diagnostic) => (
          <div key={diagnostic.packageName} className="border border-accent-error/40 rounded-lg p-3 bg-accent-error/5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-text-primary">{diagnostic.packageName}</span>
              {diagnostic.version ? <span className="text-xs text-text-muted">{`v${diagnostic.version}`}</span> : null}
            </div>
            <p className="text-xs text-text-muted mt-1 break-all">{diagnostic.source}</p>
            <p className="text-xs text-accent-error mt-1">
              {diagnostic.error ?? t({ en: 'Plugin did not load', fr: 'Le plugin ne s’est pas chargé' })}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

export function PluginsTab() {
  const t = useT()
  const { plugins } = usePlugins()
  const { data: registry, loading: registryLoading, error: registryError } = useResource(pluginRegistryResource)
  const installedIds = new Set(plugins.map((plugin) => plugin.id))

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-sm font-medium text-text-primary mb-3">
          {t({ en: 'Installed plugins', fr: 'Plugins installés' })}
        </h2>
        {plugins.length === 0 ? (
          <p className="text-sm text-text-muted">{t({ en: 'No plugins installed.', fr: 'Aucun plugin installé.' })}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {plugins.map((plugin) => (
              <InstalledPluginCard key={plugin.id} plugin={plugin} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium text-text-primary mb-3">
          {t({ en: 'Install a plugin', fr: 'Installer un plugin' })}
        </h2>
        <InstallFromInput />
      </section>

      <PluginDiagnosticsSection />

      <section>
        <h2 className="text-sm font-medium text-text-primary mb-3">
          {t({ en: 'Plugin registry', fr: 'Registre des plugins' })}
        </h2>
        {registryError ? (
          <p className="text-sm text-accent-error">
            {t({ en: 'Failed to load the plugin registry.', fr: 'Échec du chargement du registre des plugins.' })}
          </p>
        ) : registryLoading && !registry ? (
          <p className="text-sm text-text-muted">{t({ en: 'Loading…', fr: 'Chargement…' })}</p>
        ) : (registry?.plugins ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">
            {t({ en: 'No registry plugins available.', fr: 'Aucun plugin dans le registre.' })}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {(registry?.plugins ?? []).map((plugin) => (
              <RegistryPluginCard key={plugin.name} plugin={plugin} installed={installedIds.has(plugin.name)} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
