import { describe, it, expect, beforeEach } from 'vitest'
import { useConfigStore } from '../stores/config'
import { buildEditorUrl, buildWorkspaceUrl } from './editor-link'

beforeEach(() => {
  useConfigStore.setState({ platform: null })
})

describe('buildEditorUrl — Linux natif (no WSL)', () => {
  it('retourne vscode://file//path (double slash rétrocompatible)', () => {
    useConfigStore.setState({ platform: { isWSL: false, wslDistro: '' } })
    expect(buildEditorUrl('/home/user/file.ts')).toBe('vscode://file//home/user/file.ts')
  })

  it('ajoute :line', () => {
    useConfigStore.setState({ platform: { isWSL: false, wslDistro: '' } })
    expect(buildEditorUrl('/home/user/file.ts', 42)).toBe(
      'vscode://file//home/user/file.ts:42',
    )
  })

  it('résout chemin relatif + workdir', () => {
    useConfigStore.setState({ platform: { isWSL: false, wslDistro: '' } })
    expect(buildEditorUrl('src/foo.ts', undefined, '/home/user/proj')).toBe(
      'vscode://file//home/user/proj/src/foo.ts',
    )
  })

  it('normalise les backslashes Windows', () => {
    useConfigStore.setState({ platform: { isWSL: false, wslDistro: '' } })
    expect(buildEditorUrl('C:\\Users\\test\\file.ts')).toBe('vscode://file/C:/Users/test/file.ts')
  })

  it('encode les espaces', () => {
    useConfigStore.setState({ platform: { isWSL: false, wslDistro: '' } })
    expect(buildEditorUrl('/home/user/my file.ts')).toBe(
      'vscode://file//home/user/my%20file.ts',
    )
  })

  it('encode # et ?', () => {
    useConfigStore.setState({ platform: { isWSL: false, wslDistro: '' } })
    const url = buildEditorUrl('/home/user/file#2.tsx')
    expect(url).toContain('file%232.tsx')
    expect(url).not.toContain('file#2.tsx')
  })
})

describe('buildEditorUrl — WSL', () => {
  it('retourne vscode://vscode-remote/wsl+Ubuntu/path:1', () => {
    useConfigStore.setState({ platform: { isWSL: true, wslDistro: 'Ubuntu' } })
    expect(buildEditorUrl('/home/user/file.ts')).toBe(
      'vscode://vscode-remote/wsl+Ubuntu/home/user/file.ts:1',
    )
  })

  it('conserve la ligne fournie', () => {
    useConfigStore.setState({ platform: { isWSL: true, wslDistro: 'Ubuntu' } })
    expect(buildEditorUrl('/home/user/file.ts', 10)).toBe(
      'vscode://vscode-remote/wsl+Ubuntu/home/user/file.ts:10',
    )
  })

  it('gère un distro personnalisé', () => {
    useConfigStore.setState({ platform: { isWSL: true, wslDistro: 'Debian' } })
    expect(buildEditorUrl('/opt/project/main.go')).toBe(
      'vscode://vscode-remote/wsl+Debian/opt/project/main.go:1',
    )
  })

  it('résout chemin relatif + workdir', () => {
    useConfigStore.setState({ platform: { isWSL: true, wslDistro: 'Ubuntu' } })
    expect(buildEditorUrl('src/foo.ts', undefined, '/home/user/proj')).toBe(
      'vscode://vscode-remote/wsl+Ubuntu/home/user/proj/src/foo.ts:1',
    )
  })
})

describe('buildEditorUrl — platforme inconnue', () => {
  it('utilise vscode://file avec double slash par défaut', () => {
    useConfigStore.setState({ platform: null })
    expect(buildEditorUrl('/path/file.ts')).toBe('vscode://file//path/file.ts')
  })
})

describe('buildWorkspaceUrl', () => {
  it('retourne vscode://file//workspace sur Linux', () => {
    useConfigStore.setState({ platform: { isWSL: false, wslDistro: '' } })
    expect(buildWorkspaceUrl('/home/user/project')).toBe(
      'vscode://file//home/user/project',
    )
  })

  it('retourne vscode://vscode-remote/wsl+Ubuntu/workspace en WSL', () => {
    useConfigStore.setState({ platform: { isWSL: true, wslDistro: 'Ubuntu' } })
    expect(buildWorkspaceUrl('/home/user/project')).toBe(
      'vscode://vscode-remote/wsl+Ubuntu/home/user/project',
    )
  })

  it('encode les espaces', () => {
    useConfigStore.setState({ platform: { isWSL: false, wslDistro: '' } })
    expect(buildWorkspaceUrl('/home/user/my project')).toBe(
      'vscode://file//home/user/my%20project',
    )
  })
})
