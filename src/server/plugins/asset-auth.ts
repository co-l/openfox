const PLUGIN_ASSET_PATH = /^\/plugins\/[^/]+\/assets\//

/**
 * Plugin assets are loaded by sandboxed iframes, which cannot attach the
 * `x-session-token` header. They may instead present the session token as a
 * `token` query parameter, and only on asset URLs.
 */
export function pluginAssetToken(req: { path: string; query: Record<string, unknown> }): string | undefined {
  if (!PLUGIN_ASSET_PATH.test(req.path)) return undefined
  const token = req.query['token']
  return typeof token === 'string' && token.length > 0 ? token : undefined
}
