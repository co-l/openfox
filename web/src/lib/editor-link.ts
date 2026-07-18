import { useConfigStore, type PlatformInfo } from '../stores/config'

function getPlatform(): PlatformInfo | null {
  return useConfigStore.getState().platform ?? null
}

function encodePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

export function buildEditorUrl(filePath: string, line?: number, workdir?: string): string {
  const platform = getPlatform()
  const absolutePath =
    filePath.startsWith('/') || filePath.match(/^[a-zA-Z]:[/\\]/)
      ? filePath
      : workdir
        ? `${workdir.replace(/\\/g, '/').replace(/\/$/, '')}/${filePath}`
        : filePath

  const encoded = encodePath(absolutePath)

  if (platform?.isWSL && platform.wslDistro) {
    const url = `vscode://vscode-remote/wsl+${platform.wslDistro}${encoded}`
    return `${url}:${line ?? 1}`
  }

  const url = `vscode://file/${encoded}`
  return line ? `${url}:${line}` : url
}

export function buildWorkspaceUrl(workdir: string): string {
  const platform = getPlatform()
  const encoded = encodePath(workdir.replace(/\\/g, '/'))

  if (platform?.isWSL && platform.wslDistro) {
    return `vscode://vscode-remote/wsl+${platform.wslDistro}${encoded}`
  }

  return `vscode://file/${encoded}`
}

export function getWslDistro(): string | null {
  const platform = getPlatform()
  return platform?.isWSL ? platform.wslDistro || null : null
}
