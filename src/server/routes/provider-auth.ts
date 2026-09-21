import { Router, type Response } from 'express'
import type { Config, Provider } from '../../shared/types.js'
import type { ProviderAuthAdapter } from '../../provider/index.js'
import type { ProviderManager } from '../provider-manager.js'
import type { ProviderRegistry } from '../providers/plugins/registry.js'
import { logger } from '../utils/logger.js'
import { serverT } from '../i18n.js'

type AuthContext = { provider: Provider; adapter: ProviderAuthAdapter | undefined }

export function createProviderAuthRoutes(
  config: Config,
  providerManager: ProviderManager,
  registry: ProviderRegistry,
): Router {
  const router = Router()

  function resolveAuthContext(providerId: string, res: Response): AuthContext | undefined {
    const provider = providerManager.getProviders().find((item) => item.id === providerId)
    if (!provider) {
      res.status(404).json({ error: serverT({ en: 'Provider not found', fr: 'Fournisseur introuvable' }) })
      return undefined
    }
    return { provider, adapter: registry.getAuth(provider.authAdapter) }
  }

  function missingAuthPlugin(provider: Provider): string {
    return serverT(
      {
        en: 'Missing provider auth plugin: {{adapter}}',
        fr: 'Plugin d’authentification du fournisseur manquant : {{adapter}}',
      },
      { adapter: provider.authAdapter ?? 'unknown' },
    )
  }

  router.post('/:providerId/login', async (req, res) => {
    const context = resolveAuthContext(req.params.providerId as string, res)
    if (!context) return
    const { provider, adapter } = context
    if (!adapter) return res.status(424).json({ error: missingAuthPlugin(provider) })

    try {
      const { challenge, completion } = await adapter.beginLogin({ providerId: provider.id })
      void completion
        .then(async ({ credentialRef }) => {
          const { loadGlobalConfig, saveGlobalConfig, updateProvider } = await import('../../cli/config.js')
          const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
          const updatedConfig = updateProvider(globalConfig, provider.id, { credentialRef, authAdapter: adapter.id })
          await saveGlobalConfig(config.mode ?? 'production', updatedConfig, config.globalConfigPath)
          providerManager.setProviders(updatedConfig.providers, updatedConfig.defaultModelSelection ?? undefined)
        })
        .catch((err) => {
          logger.error('Provider auth completion failed', {
            providerId: provider.id,
            authAdapter: adapter.id,
            error: err instanceof Error ? err.message : String(err),
          })
        })
      res.json(challenge)
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : serverT({
                en: 'Unable to start provider login',
                fr: 'Impossible de démarrer la connexion au fournisseur',
              }),
      })
    }
  })

  router.get('/:providerId/status', async (req, res) => {
    const context = resolveAuthContext(req.params.providerId as string, res)
    if (!context) return
    const { provider, adapter } = context
    if (!adapter) return res.json({ state: 'disconnected', error: missingAuthPlugin(provider) })

    res.json(
      await adapter.getStatus({
        providerId: provider.id,
        ...(provider.credentialRef && { credentialRef: provider.credentialRef }),
      }),
    )
  })

  router.post('/:providerId/logout', async (req, res) => {
    const context = resolveAuthContext(req.params.providerId as string, res)
    if (!context) return
    const { provider, adapter } = context
    if (adapter) {
      const ref = provider.credentialRef ?? provider.id
      await adapter.logout(ref)
    }

    const { loadGlobalConfig, saveGlobalConfig } = await import('../../cli/config.js')
    const globalConfig = await loadGlobalConfig(config.mode ?? 'production', config.globalConfigPath)
    const updatedConfig = {
      ...globalConfig,
      providers: globalConfig.providers.map((item) => {
        if (item.id !== provider.id) return item
        const updated: Provider = { ...item }
        delete updated.credentialRef
        return updated
      }),
    }
    await saveGlobalConfig(config.mode ?? 'production', updatedConfig, config.globalConfigPath)
    providerManager.setProviders(updatedConfig.providers, updatedConfig.defaultModelSelection ?? undefined)
    res.json({ success: true })
  })

  return router
}
