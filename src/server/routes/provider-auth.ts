import { Router } from 'express'
import type { Config, Provider } from '../../shared/types.js'
import type { ProviderManager } from '../provider-manager.js'
import { OpenAIBrowserAuthAdapter } from '../providers/adapters/openai-browser-auth.js'
import { fetchCodexModels } from '../providers/adapters/models-dev-catalog.js'

export function createProviderAuthRoutes(
  config: Config,
  providerManager: ProviderManager,
  openaiAuth: OpenAIBrowserAuthAdapter,
): Router {
  const router = Router()

  router.get('/openai/models', async (_req, res) => {
    try {
      res.json({ models: await fetchCodexModels() })
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'Failed to fetch OpenAI models' })
    }
  })

  router.post('/:providerId/login', async (req, res) => {
    const providerId = req.params.providerId as string
    const provider = providerManager.getProviders().find((item) => item.id === providerId)
    if (!provider) return res.status(404).json({ error: 'Provider not found' })
    if (provider.authAdapter !== openaiAuth.id) {
      return res.status(400).json({ error: 'Provider does not use OpenAI account auth' })
    }

    let login
    try {
      login = await openaiAuth.beginDeviceLoginForProvider(providerId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start OpenAI device authorization'
      return res.status(message.includes(': 429') ? 429 : 502).json({ error: message })
    }
    const { challenge, completion } = login
    void completion
      .then(async (result) => {
        const { loadGlobalConfig, saveGlobalConfig, updateProvider } = await import('../../cli/config.js')
        const globalConfig = await loadGlobalConfig(config.mode ?? 'production')
        const updatedConfig = updateProvider(globalConfig, result.providerId, {
          credentialRef: result.credentialRef,
          authAdapter: openaiAuth.id,
        })
        await saveGlobalConfig(config.mode ?? 'production', updatedConfig)
        providerManager.setProviders(updatedConfig.providers, updatedConfig.defaultModelSelection ?? undefined)
      })
      .catch(() => undefined)
    res.json(challenge)
  })

  router.get('/:providerId/status', async (req, res) => {
    const provider = providerManager.getProviders().find((item) => item.id === req.params.providerId)
    if (!provider) return res.status(404).json({ error: 'Provider not found' })
    const status = await openaiAuth.getStatus(provider.credentialRef)
    res.json(status)
  })

  router.post('/:providerId/logout', async (req, res) => {
    const providerId = req.params.providerId as string
    const provider = providerManager.getProviders().find((item) => item.id === providerId)
    if (!provider) return res.status(404).json({ error: 'Provider not found' })
    if (provider.credentialRef) await openaiAuth.logout(provider.credentialRef)

    const { loadGlobalConfig, saveGlobalConfig } = await import('../../cli/config.js')
    const globalConfig = await loadGlobalConfig(config.mode ?? 'production')
    const updatedConfig = {
      ...globalConfig,
      providers: globalConfig.providers.map((item) => {
        if (item.id !== providerId) return item
        const updated: Provider = { ...item }
        delete updated.credentialRef
        return updated
      }),
    }
    await saveGlobalConfig(config.mode ?? 'production', updatedConfig)
    providerManager.setProviders(updatedConfig.providers, updatedConfig.defaultModelSelection ?? undefined)
    res.json({ success: true })
  })

  router.get('/openai/callback', async (req, res) => {
    const code = typeof req.query['code'] === 'string' ? req.query['code'] : undefined
    const state = typeof req.query['state'] === 'string' ? req.query['state'] : undefined
    const oauthError = typeof req.query['error'] === 'string' ? req.query['error'] : undefined
    if (oauthError) return res.status(400).send(`OpenAI sign-in failed: ${oauthError}`)
    if (!code || !state) return res.status(400).send('Missing OAuth code or state')

    try {
      const result = await openaiAuth.completeLogin(code, state)
      const { loadGlobalConfig, saveGlobalConfig, updateProvider } = await import('../../cli/config.js')
      const globalConfig = await loadGlobalConfig(config.mode ?? 'production')
      const updatedConfig = updateProvider(globalConfig, result.providerId, {
        credentialRef: result.credentialRef,
        authAdapter: openaiAuth.id,
      })
      await saveGlobalConfig(config.mode ?? 'production', updatedConfig)
      providerManager.setProviders(updatedConfig.providers, updatedConfig.defaultModelSelection ?? undefined)
      res.type('html').send('<!doctype html><title>OpenFox</title><p>OpenAI account connected. You can close this tab.</p>')
    } catch (error) {
      res.status(400).send(error instanceof Error ? error.message : 'OpenAI sign-in failed')
    }
  })

  return router
}
