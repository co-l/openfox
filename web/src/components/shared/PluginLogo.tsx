import { pluginIcon } from '../plugins/plugin-ui-utils'
import { appUrl } from '../../lib/basePath'
import { sanitizeSvg } from '../../lib/sanitize'
import type { PluginInfo } from '@shared/plugin.js'

const BUILTIN_PROVIDER_LOGOS: Record<string, string> = {
  lmstudio: '/assets/providers/lmstudio.webp',
  'lm studio': '/assets/providers/lmstudio.webp',
  'lm-studio': '/assets/providers/lmstudio.webp',
  llamacpp: '/assets/providers/llama-cpp.png',
  'llama.cpp': '/assets/providers/llama-cpp.png',
  'llama-cpp': '/assets/providers/llama-cpp.png',
  llama_cpp: '/assets/providers/llama-cpp.png',
  ollama: '/assets/providers/ollama.webp',
  vllm: '/assets/providers/vllm.png',
  unsloth: '/assets/providers/unsloth.png',
}

export function findPluginLogoForProvider(
  provider:
    | {
        id?: string
        preset?: string
        transport?: string
        transportAdapter?: string
        authAdapter?: string
        backend?: string
        name?: string
        logo?: string
        icon?: string
      }
    | undefined,
  plugins: PluginInfo[] = [],
): string | undefined {
  if (!provider) return undefined

  if (provider.logo) return provider.logo
  if (provider.icon) return provider.icon

  const presetId = provider.preset?.toLowerCase()
  const transport = (provider.transport || provider.transportAdapter || '').toLowerCase()
  const auth = (provider.authAdapter || '').toLowerCase()
  const backend = (provider.backend || '').toLowerCase()
  const name = (provider.name || '').toLowerCase()
  const pid = (provider.id || '').toLowerCase()

  if (plugins.length > 0) {
    for (const plugin of plugins) {
      if (!plugin.icon && !plugin.logo) continue
      const pluginId = plugin.id.toLowerCase()
      const cleanId = pluginId.replace(/^openfox-/, '')

      if (presetId && (presetId === cleanId || presetId === pluginId || cleanId.includes(presetId))) {
        return plugin.icon || plugin.logo
      }
      if (transport && (transport.includes(cleanId) || transport.includes(pluginId))) {
        return plugin.icon || plugin.logo
      }
      if (auth && (auth.includes(cleanId) || auth.includes(pluginId))) {
        return plugin.icon || plugin.logo
      }
      if (backend && (backend === cleanId || backend === pluginId)) {
        return plugin.icon || plugin.logo
      }
      if (pid && (pid === cleanId || pid === pluginId || pid.startsWith(cleanId) || pid.startsWith(pluginId))) {
        return plugin.icon || plugin.logo
      }
      if (
        name &&
        (name === cleanId || name === pluginId || (plugin.displayName && name === plugin.displayName.toLowerCase()))
      ) {
        return plugin.icon || plugin.logo
      }
    }
  }

  const candidates = [backend, presetId, name, pid].filter(Boolean) as string[]
  for (const c of candidates) {
    if (BUILTIN_PROVIDER_LOGOS[c]) return BUILTIN_PROVIDER_LOGOS[c]
    const normalized = c.replace(/[^a-z0-9]/g, '')
    if (BUILTIN_PROVIDER_LOGOS[normalized]) return BUILTIN_PROVIDER_LOGOS[normalized]
  }

  if (
    name.includes('lm studio') ||
    name.includes('lmstudio') ||
    backend.includes('lmstudio') ||
    pid.includes('lmstudio')
  ) {
    return BUILTIN_PROVIDER_LOGOS['lm studio']
  }
  if (
    name.includes('llama.cpp') ||
    name.includes('llamacpp') ||
    backend.includes('llamacpp') ||
    pid.includes('llamacpp')
  ) {
    return BUILTIN_PROVIDER_LOGOS['llama.cpp']
  }
  if (name.includes('ollama') || backend.includes('ollama') || pid.includes('ollama')) {
    return BUILTIN_PROVIDER_LOGOS['ollama']
  }
  if (name.includes('vllm') || backend.includes('vllm') || pid.includes('vllm')) {
    return BUILTIN_PROVIDER_LOGOS['vllm']
  }
  if (name.includes('unsloth') || backend.includes('unsloth') || pid.includes('unsloth')) {
    return BUILTIN_PROVIDER_LOGOS['unsloth']
  }

  return undefined
}

export function PluginLogo({
  icon,
  logo,
  className = 'w-4 h-4',
  imgClassName,
}: {
  icon?: string
  logo?: string
  className?: string
  imgClassName?: string
}) {
  const iconValue = icon || logo
  if (!iconValue) return null

  const trimmed = iconValue.trim()

  if (trimmed.startsWith('<svg')) {
    const safeSvg = sanitizeSvg(trimmed)
    if (!safeSvg) return null
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 [&>svg]:w-full [&>svg]:h-full ${className}`}
        dangerouslySetInnerHTML={{ __html: safeSvg }}
      />
    )
  }

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('/')
  ) {
    const src = trimmed.startsWith('/') ? appUrl(trimmed) : trimmed
    return (
      <img
        src={src}
        alt={''}
        aria-hidden="true"
        className={`object-contain shrink-0 rounded-sm ${className} ${imgClassName ?? ''}`}
      />
    )
  }

  const IconComp = pluginIcon(trimmed)
  return <IconComp className={className} />
}
