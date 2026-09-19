import { readConfig } from './resources'
import type { PlatformInfo } from '../stores/config'

function getPlatform(): PlatformInfo | null {
  return readConfig()?.platform ?? null
}

function encodePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

/** User-configured remote prefix (e.g. "vscode-remote/ssh-remote+user@host").
 * A trailing slash is optional in the setting, so strip it here. */
function normalizeRemotePrefix(prefix?: string): string {
  return (prefix ?? '').trim().replace(/\/+$/, '')
}

/** VS Code requires :line:column on file URLs and allows opening wsl / ssh
 * folders when the target is addressed through a vscode-remote authority. */
function editorLineSuffix(line?: number): string {
  return `:${line ?? 1}:1?windowId=_blank`
}

export function buildEditorUrl(filePath: string, line?: number, workdir?: string, remotePrefix?: string): string {
  const platform = getPlatform()
  const absolutePath =
    filePath.startsWith('/') || filePath.match(/^[a-zA-Z]:[/\\]/)
      ? filePath
      : workdir
        ? `${workdir.replace(/\\/g, '/').replace(/\/$/, '')}/${filePath}`
        : filePath

  const encoded = encodePath(absolutePath)
  const remote = normalizeRemotePrefix(remotePrefix)

  let url: string
  if (platform?.isWSL && platform.wslDistro) {
    url = `vscode://vscode-remote/wsl+${platform.wslDistro}${encoded}`
  } else if (remote !== '') {
    url = `vscode://${remote}${encoded}`
  } else {
    url = `vscode://file/${encoded}`
  }

  return `${url}${editorLineSuffix(line)}`
}

export function buildWorkspaceUrl(workdir: string, remotePrefix?: string): string {
  const platform = getPlatform()
  const encoded = encodePath(workdir.replace(/\\/g, '/'))
  const remote = normalizeRemotePrefix(remotePrefix)

  if (platform?.isWSL && platform.wslDistro) {
    return `vscode://vscode-remote/wsl+${platform.wslDistro}${encoded}`
  }

  if (remote !== '') {
    return `vscode://${remote}${encoded}`
  }

  return `vscode://file/${encoded}`
}
