import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../../../lib/api'
import { useT } from '../../../hooks/useT'
import { Button } from '../../shared/Button'
import { ConfirmModal } from '../../shared/ConfirmModal'
import { SettingsIcon } from '../../shared/icons/SettingsIcon'
import { PluginSettingsModal } from '../PluginSettingsModal'

const STORAGE_KEY = 'openfox_user_plugins'

interface RegistryPlugin {
  name: string
  displayName: string
  description: string
  githubUrl: string
}

interface PluginWithVersion extends RegistryPlugin {
  latestVersion: string | null
  versionLoading: boolean
}

type InstallState = 'idle' | 'installing' | 'installed' | 'error'

function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\/|$)/)
  if (!m) return null
  return { owner: m[1]!, repo: m[2]!.replace(/\.git$/, '') }
}

async function fetchLatestVersion(githubUrl: string): Promise<string | null> {
  const parsed = parseGithubRepo(githubUrl)
  if (!parsed) return null
  try {
    const res = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/releases/latest`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data.tag_name as string) ?? null
  } catch {
    return null
  }
}

function loadUserPlugins(): RegistryPlugin[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveUserPlugins(plugins: RegistryPlugin[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins))
}

function AddPluginForm({ onAdd }: { onAdd: (p: RegistryPlugin) => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [githubUrl, setGithubUrl] = useState('')
  const [added, setAdded] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !githubUrl.trim()) return
    onAdd({
      name: name.trim(),
      displayName: name.trim(),
      description: t({ en: 'User-added plugin', fr: 'Plugin ajouté par l’utilisateur' }),
      githubUrl: githubUrl.trim(),
    })
    setName('')
    setGithubUrl('')
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end">
      <div className="flex-1">
        <label className="text-xs text-text-muted block mb-1">{t({ en: 'Name', fr: 'Nom' })}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-plugin"
          className="w-full px-2 py-1 text-sm text-text-primary bg-bg-tertiary border border-border rounded"
        />
      </div>
      <div className="flex-[2]">
        <label className="text-xs text-text-muted block mb-1">{t({ en: 'GitHub URL', fr: 'URL GitHub' })}</label>
        <input
          type="text"
          value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)}
          placeholder="https://github.com/user/repo"
          className="w-full px-2 py-1 text-sm text-text-primary bg-bg-tertiary border border-border rounded"
        />
      </div>
      <Button type="submit" variant="primary" size="sm">
        {added ? t({ en: 'Added', fr: 'Ajouté' }) : t({ en: 'Add', fr: 'Ajouter' })}
      </Button>
    </form>
  )
}

function PluginCard({
  plugin,
  initiallyInstalled,
  installedVersion,
  hasSettings = false,
  onInstalled,
  onRemove,
  onOpenFolder,
}: {
  plugin: PluginWithVersion
  initiallyInstalled: boolean
  installedVersion: string | null
  hasSettings?: boolean
  onInstalled?: (name: string, hasSettings: boolean) => void
  onRemove: (name: string) => void
  onOpenFolder: (name: string) => void
}) {
  const t = useT()
  const [installState, setInstallState] = useState<InstallState>(initiallyInstalled ? 'installed' : 'idle')
  const [updating, setUpdating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [localVersion, setLocalVersion] = useState<string | null>(installedVersion)
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)

  useEffect(() => {
    setLocalVersion(installedVersion)
  }, [installedVersion])

  const doInstall = useCallback(async () => {
    const res = await authFetch('/api/plugins/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ githubUrl: plugin.githubUrl }),
    })
    const data = await res.json()
    if (res.ok) {
      setInstallState('installed')
      if (plugin.latestVersion) setLocalVersion(plugin.latestVersion)
      if (onInstalled) {
        onInstalled(plugin.name, Boolean(data.hasSettings))
      }
      if (!data.loaded)
        setErrorMsg(
          data.loadError ??
            t({ en: 'Plugin installed but failed to load', fr: 'Plugin installé mais échec du chargement' }),
        )
    } else {
      throw new Error(data.error ?? t({ en: 'Install failed', fr: 'Échec de l’installation' }))
    }
  }, [plugin.githubUrl, plugin.name, plugin.latestVersion, onInstalled, t])

  const handleInstall = async () => {
    setInstallState('installing')
    setErrorMsg('')
    try {
      await doInstall()
    } catch (e) {
      setInstallState('error')
      setErrorMsg(e instanceof Error ? e.message : t({ en: 'Connection error', fr: 'Erreur de connexion' }))
    }
  }

  const handleRemove = () => {
    setShowRemoveConfirm(true)
  }

  const handleConfirmRemove = async () => {
    setRemoving(true)
    try {
      const res = await authFetch(`/api/plugins/${plugin.name}`, { method: 'DELETE' })
      if (res.ok) {
        setInstallState('idle')
        onRemove(plugin.name)
      }
    } catch {
      // ignore
    }
    setRemoving(false)
    setShowRemoveConfirm(false)
  }

  const handleUpdate = async () => {
    setUpdating(true)
    setErrorMsg('')
    try {
      await doInstall()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t({ en: 'Update failed', fr: 'Échec de la mise à jour' }))
    }
    setUpdating(false)
  }

  const displayVersion = localVersion ?? installedVersion
  const hasUpdate =
    plugin.latestVersion && displayVersion && displayVersion !== 'unknown' && plugin.latestVersion !== displayVersion
  const buttonLabel =
    installState === 'installing'
      ? t({ en: 'Installing…', fr: 'Installation…' })
      : updating
        ? t({ en: 'Updating…', fr: 'Mise à jour…' })
        : installState === 'installed'
          ? t({ en: 'Installed ✓', fr: 'Installé ✓' })
          : t({ en: 'Install', fr: 'Installer' })
  const disabled = installState === 'installing' || installState === 'installed' || updating

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-text-primary">{plugin.displayName}</h3>
            <span className="text-xs text-text-muted">({plugin.name})</span>
          </div>
          <p className="text-xs text-text-muted mt-1">{plugin.description}</p>
          <div className="flex items-center gap-3 mt-2 text-xs">
            {plugin.githubUrl && (
              <a
                href={plugin.githubUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent-primary hover:underline"
              >
                GitHub
              </a>
            )}
            {plugin.versionLoading ? (
              <span className="text-text-muted">{t({ en: 'Loading version…', fr: 'Chargement de la version…' })}</span>
            ) : plugin.latestVersion ? (
              <span className="text-text-muted">{`v${plugin.latestVersion}`}</span>
            ) : null}
            {displayVersion && displayVersion !== 'unknown' && (
              <span className="text-text-muted">
                {t({ en: 'installed: v{{version}}', fr: 'installé : v{{version}}' }, { version: displayVersion })}
              </span>
            )}
          </div>
          {installState === 'error' && errorMsg && <p className="text-xs text-accent-error mt-1">{errorMsg}</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-1">
            {plugin.githubUrl && (
              <Button
                variant={installState === 'installed' ? 'secondary' : 'primary'}
                size="sm"
                onClick={handleInstall}
                disabled={disabled}
              >
                {buttonLabel}
              </Button>
            )}
            {hasUpdate && (
              <Button variant="primary" size="sm" onClick={handleUpdate}>
                {t({ en: 'Update', fr: 'Mettre à jour' })}
              </Button>
            )}
            {installState === 'installed' && hasSettings && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowSettingsModal(true)}
                className="flex items-center gap-1"
              >
                <SettingsIcon className="w-3.5 h-3.5" />
                {t({ en: 'Settings', fr: 'Paramètres' })}
              </Button>
            )}
            {installState === 'installed' && (
              <Button variant="danger" size="sm" onClick={handleRemove}>
                {t({ en: 'Remove', fr: 'Supprimer' })}
              </Button>
            )}
          </div>
          {installState === 'installed' && (
            <button onClick={() => onOpenFolder(plugin.name)} className="text-xs text-accent-primary hover:underline">
              {t({ en: 'Open folder', fr: 'Ouvrir le dossier' })}
            </button>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={showRemoveConfirm}
        onClose={() => setShowRemoveConfirm(false)}
        onConfirm={handleConfirmRemove}
        title={t({ en: 'Remove "{{name}}"?', fr: 'Supprimer « {{name}} » ?' }, { name: plugin.displayName })}
        message={t(
          {
            en: 'Remove the "{{name}}" plugin from your installation.',
            fr: 'Supprimez le plugin « {{name}} » de votre installation.',
          },
          { name: plugin.displayName },
        )}
        confirmLabel={t({ en: 'Remove', fr: 'Supprimer' })}
        confirmVariant="danger"
        disabled={removing}
      />

      {showSettingsModal && (
        <PluginSettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          pluginName={plugin.name}
          pluginDisplayName={plugin.displayName}
        />
      )}
    </div>
  )
}

export function PluginsTab() {
  const t = useT()
  const [registryPlugins, setRegistryPlugins] = useState<PluginWithVersion[]>([])
  const [userPlugins, setUserPlugins] = useState<PluginWithVersion[]>([])
  const [installedVersions, setInstalledVersions] = useState<Record<string, string | null>>({})
  const [installedSettings, setInstalledSettings] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [duplicateWarning, setDuplicateWarning] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      // Authorized transient read: plugin registry/installed lists are one-shot modal loads, not shared state.
      authFetch('/api/plugins/registry').then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      }),
      // Authorized transient read: plugin registry/installed lists are one-shot modal loads, not shared state.
      authFetch('/api/plugins/installed').then((r) => {
        if (!r.ok) return { installed: [] }
        return r.json()
      }),
    ])
      .then(([registryData, installedData]) => {
        if (cancelled) return
        const versions: Record<string, string | null> = {}
        const settingsMap: Record<string, boolean> = {}
        const installedList = installedData.installed as {
          name: string
          version: string | null
          hasSettings?: boolean
        }[]
        for (const p of installedList) {
          versions[p.name] = p.version
          settingsMap[p.name] = Boolean(p.hasSettings)
        }
        setInstalledVersions(versions)
        setInstalledSettings(settingsMap)

        const items = (registryData.plugins as RegistryPlugin[]).map((p) => ({
          ...p,
          latestVersion: null,
          versionLoading: true,
        }))
        setRegistryPlugins(items)
        items.forEach((p) => {
          fetchLatestVersion(p.githubUrl).then((v) => {
            if (!cancelled)
              setRegistryPlugins((prev) =>
                prev.map((x) => (x.name === p.name ? { ...x, latestVersion: v, versionLoading: false } : x)),
              )
          })
        })

        // Auto-discover plugins on disk not in registry or user list
        const known = new Set(items.map((p) => p.name))
        const userSaved = loadUserPlugins()
        const discovered: PluginWithVersion[] = []
        for (const p of installedList) {
          if (!known.has(p.name) && !userSaved.some((u) => u.name === p.name)) {
            discovered.push({
              name: p.name,
              displayName: p.name,
              description: t({ en: 'Found on disk', fr: 'Trouvé sur le disque' }),
              githubUrl: '',
              latestVersion: null,
              versionLoading: false,
            })
          }
        }
        if (discovered.length > 0) setUserPlugins((prev) => [...prev, ...discovered])
      })
      .catch((err) => {
        if (!cancelled)
          setFetchError(
            err instanceof Error
              ? err.message
              : t({ en: 'Failed to load plugins', fr: 'Échec du chargement des plugins' }),
          )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    const saved = loadUserPlugins()
    if (saved.length > 0) {
      setUserPlugins(saved.map((p) => ({ ...p, latestVersion: null, versionLoading: true })))
      saved.forEach((p) => {
        fetchLatestVersion(p.githubUrl).then((v) => {
          if (!cancelled)
            setUserPlugins((prev) =>
              prev.map((x) => (x.name === p.name ? { ...x, latestVersion: v, versionLoading: false } : x)),
            )
        })
      })
    }
    return () => {
      cancelled = true
    }
  }, [])

  const handleOpenFolder = async (name?: string) => {
    try {
      if (name) await authFetch(`/api/plugins/${name}/open-folder`)
      else await authFetch('/api/plugins/open-folder')
    } catch {
      // ignore
    }
  }

  const handleRemovePlugin = useCallback((name: string) => {
    setInstalledVersions((prev) => {
      const n = { ...prev }
      delete n[name]
      return n
    })
    const saved = loadUserPlugins()
    const filtered = saved.filter((p) => p.name !== name)
    if (filtered.length !== saved.length) saveUserPlugins(filtered)
    setUserPlugins((prev) => prev.filter((p) => p.name !== name))
  }, [])

  const handleAddUserPlugin = useCallback(
    (p: RegistryPlugin) => {
      const registryNames = new Set(registryPlugins.map((x) => x.name))
      if (registryNames.has(p.name)) {
        setDuplicateWarning(
          t(
            {
              en: '"{{name}}" is already listed in the registry and won\'t be added again.',
              fr: '« {{name}} » figure déjà dans le registre et ne sera pas ajouté à nouveau.',
            },
            { name: p.displayName },
          ),
        )
        return
      }
      const saved = loadUserPlugins()
      saveUserPlugins([...saved, p])
      setUserPlugins((prev) => [...prev, { ...p, latestVersion: null, versionLoading: true }])
      fetchLatestVersion(p.githubUrl).then((v) => {
        setUserPlugins((prev) =>
          prev.map((x) => (x.name === p.name ? { ...x, latestVersion: v, versionLoading: false } : x)),
        )
      })
    },
    [registryPlugins],
  )

  const handleInstalled = useCallback((name: string, hasSettings: boolean) => {
    setInstalledSettings((prev) => ({ ...prev, [name]: hasSettings }))
  }, [])

  const seen = new Set<string>()
  const allPlugins = [...registryPlugins, ...userPlugins].filter((p) => {
    if (seen.has(p.name)) return false
    seen.add(p.name)
    return true
  })

  if (loading)
    return (
      <div className="text-sm text-text-muted">{t({ en: 'Loading plugins...', fr: 'Chargement des plugins…' })}</div>
    )

  return (
    <div className="space-y-4">
      {fetchError && (
        <div className="text-sm text-accent-error bg-accent-error/10 border border-accent-error/30 rounded-lg p-3">
          {t({ en: 'Failed to load plugin registry:', fr: 'Échec du chargement du registre des plugins :' })}{' '}
          {fetchError}
        </div>
      )}
      {duplicateWarning && (
        <div className="text-sm text-accent-warning bg-accent-warning/10 border border-accent-warning/30 rounded-lg p-3 flex justify-between items-center">
          <span>{duplicateWarning}</span>
          <button onClick={() => setDuplicateWarning('')} className="text-text-muted hover:text-text-primary ml-2">
            &times;
          </button>
        </div>
      )}
      <div className="border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium text-text-primary mb-3">
          {t({ en: 'Add Plugin', fr: 'Ajouter un plugin' })}
        </h3>
        <AddPluginForm onAdd={handleAddUserPlugin} />
      </div>

      {allPlugins.length === 0 && !fetchError && (
        <div className="text-sm text-text-muted">{t({ en: 'No plugins found.', fr: 'Aucun plugin trouvé.' })}</div>
      )}

      {allPlugins.map((plugin) => (
        <PluginCard
          key={plugin.name}
          plugin={plugin}
          initiallyInstalled={plugin.name in installedVersions}
          installedVersion={installedVersions[plugin.name] ?? null}
          hasSettings={installedSettings[plugin.name] ?? false}
          onInstalled={handleInstalled}
          onRemove={handleRemovePlugin}
          onOpenFolder={handleOpenFolder}
        />
      ))}
    </div>
  )
}
