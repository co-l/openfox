import { Router } from 'express'
import type { Config, Provider } from '../../shared/types.js'
import type { ProviderManager } from '../provider-manager.js'
import { OpenAIBrowserAuthAdapter } from '../providers/adapters/openai-browser-auth.js'

export function createProviderAuthRoutes(
  config: Config,
  providerManager: ProviderManager,
  openaiAuth: OpenAIBrowserAuthAdapter,
): Router {
  const router = Router()

  router.post('/:providerId/login', async (req, res) => {
    const providerId = req.params.providerId as string
    const provider = providerManager.getProviders().find((item) => item.id === providerId)
    if (!provider) return res.status(404).json({ error: 'Provider not found' })
    if (provider.authAdapter !== openaiAuth.id) {
      return res.status(400).json({ error: 'Provider does not use OpenAI account auth' })
    }

    const host = config.server.host === '127.0.0.1' ? 'localhost' : config.server.host
    const redirectUri = `http://${host}:${config.server.port}/api/provider-auth/openai/callback`
    const challenge = await openaiAuth.beginLoginForProvider(providerId, redirectUri)
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
