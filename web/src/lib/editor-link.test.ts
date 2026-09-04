// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { clearCache } from './resourceCache'
import { configResource } from './resources'
import { buildEditorUrl, buildWorkspaceUrl } from './editor-link'

function seedConfig(platform: { isWSL: boolean; wslDistro: string } | null): void {
  configResource.write({
    version: null,
    model: null,
    maxContext: 200000,
    llmUrl: null,
    llmStatus: 'unknown',
    backend: 'unknown',
    defaultModelSelection: null,
    visionFallback: null,
    platform,
    workdir: null,
    locale: 'automatic',
  })
}

beforeEach(() => {
  clearCache()
  seedConfig(null)
})

describe('buildEditorUrl — Linux native (no WSL)', () => {
  it('returns vscode://file//path with default line suffix', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    expect(buildEditorUrl('/home/user/file.ts')).toBe('vscode://file//home/user/file.ts:1:1?windowId=_blank')
  })

  it('appends :line:1 suffix', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    expect(buildEditorUrl('/home/user/file.ts', 42)).toBe('vscode://file//home/user/file.ts:42:1?windowId=_blank')
  })

  it('resolves relative path with workdir', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    expect(buildEditorUrl('src/foo.ts', undefined, '/home/user/proj')).toBe(
      'vscode://file//home/user/proj/src/foo.ts:1:1?windowId=_blank',
    )
  })

  it('normalizes Windows backslashes', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    expect(buildEditorUrl('C:\\Users\\test\\file.ts')).toBe('vscode://file/C:/Users/test/file.ts:1:1?windowId=_blank')
  })

  it('encodes spaces', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    expect(buildEditorUrl('/home/user/my file.ts')).toBe('vscode://file//home/user/my%20file.ts:1:1?windowId=_blank')
  })

  it('encodes # and ? characters', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    const url = buildEditorUrl('/home/user/file#2.tsx')
    expect(url).toContain('file%232.tsx')
    expect(url).not.toContain('file#2.tsx')
  })
})

describe('buildEditorUrl — WSL', () => {
  it('returns vscode://vscode-remote/wsl+Ubuntu/path:1:1', () => {
    seedConfig({ isWSL: true, wslDistro: 'Ubuntu' })
    expect(buildEditorUrl('/home/user/file.ts')).toBe(
      'vscode://vscode-remote/wsl+Ubuntu/home/user/file.ts:1:1?windowId=_blank',
    )
  })

  it('preserves the provided line number', () => {
    seedConfig({ isWSL: true, wslDistro: 'Ubuntu' })
    expect(buildEditorUrl('/home/user/file.ts', 10)).toBe(
      'vscode://vscode-remote/wsl+Ubuntu/home/user/file.ts:10:1?windowId=_blank',
    )
  })

  it('handles custom distro names', () => {
    seedConfig({ isWSL: true, wslDistro: 'Debian' })
    expect(buildEditorUrl('/opt/project/main.go')).toBe(
      'vscode://vscode-remote/wsl+Debian/opt/project/main.go:1:1?windowId=_blank',
    )
  })

  it('resolves relative path with workdir', () => {
    seedConfig({ isWSL: true, wslDistro: 'Ubuntu' })
    expect(buildEditorUrl('src/foo.ts', undefined, '/home/user/proj')).toBe(
      'vscode://vscode-remote/wsl+Ubuntu/home/user/proj/src/foo.ts:1:1?windowId=_blank',
    )
  })
})

describe('buildEditorUrl — remote prefix', () => {
  it('replaces vscode://file with the remote prefix', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    expect(buildEditorUrl('/home/user/file.ts', undefined, undefined, 'vscode-remote/ssh-remote+ia@192.168.1.35')).toBe(
      'vscode://vscode-remote/ssh-remote+ia@192.168.1.35/home/user/file.ts:1:1?windowId=_blank',
    )
  })

  it('normalizes trailing slashes on the prefix', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    expect(
      buildEditorUrl('/home/user/file.ts', undefined, undefined, 'vscode-remote/ssh-remote+ia@192.168.1.35/'),
    ).toBe('vscode://vscode-remote/ssh-remote+ia@192.168.1.35/home/user/file.ts:1:1?windowId=_blank')
  })

  it('keeps the provided line number', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    expect(buildEditorUrl('/home/user/file.ts', 7, undefined, 'vscode-remote/ssh-remote+user@host')).toBe(
      'vscode://vscode-remote/ssh-remote+user@host/home/user/file.ts:7:1?windowId=_blank',
    )
  })

  it('is ignored on WSL where detection takes priority', () => {
    seedConfig({ isWSL: true, wslDistro: 'Ubuntu' })
    expect(buildEditorUrl('/home/user/file.ts', undefined, undefined, 'vscode-remote/ssh-remote+user@host')).toBe(
      'vscode://vscode-remote/wsl+Ubuntu/home/user/file.ts:1:1?windowId=_blank',
    )
  })

  it('treats an empty prefix as unset', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    expect(buildEditorUrl('/home/user/file.ts', undefined, undefined, '')).toBe(
      'vscode://file//home/user/file.ts:1:1?windowId=_blank',
    )
  })

  it('applies on unknown platform', () => {
    seedConfig(null)
    expect(buildEditorUrl('/path/file.ts', undefined, undefined, 'vscode-remote/ssh-remote+user@host')).toBe(
      'vscode://vscode-remote/ssh-remote+user@host/path/file.ts:1:1?windowId=_blank',
    )
  })
})

describe('buildEditorUrl — unknown platform', () => {
  it('defaults to vscode://file with double slash', () => {
    seedConfig(null)
    expect(buildEditorUrl('/path/file.ts')).toBe('vscode://file//path/file.ts:1:1?windowId=_blank')
  })
})

describe('buildWorkspaceUrl', () => {
  it('returns vscode://file//workspace on Linux', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    expect(buildWorkspaceUrl('/home/user/project')).toBe('vscode://file//home/user/project')
  })

  it('returns vscode://vscode-remote/wsl+Ubuntu/workspace on WSL', () => {
    seedConfig({ isWSL: true, wslDistro: 'Ubuntu' })
    expect(buildWorkspaceUrl('/home/user/project')).toBe('vscode://vscode-remote/wsl+Ubuntu/home/user/project')
  })

  it('encodes spaces', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    expect(buildWorkspaceUrl('/home/user/my project')).toBe('vscode://file//home/user/my%20project')
  })

  it('applies the remote prefix instead of vscode://file', () => {
    seedConfig({ isWSL: false, wslDistro: '' })
    expect(buildWorkspaceUrl('/home/user/project', 'vscode-remote/ssh-remote+ia@192.168.1.35/')).toBe(
      'vscode://vscode-remote/ssh-remote+ia@192.168.1.35/home/user/project',
    )
  })

  it('is ignored on WSL where detection takes priority', () => {
    seedConfig({ isWSL: true, wslDistro: 'Ubuntu' })
    expect(buildWorkspaceUrl('/home/user/project', 'vscode-remote/ssh-remote+user@host')).toBe(
      'vscode://vscode-remote/wsl+Ubuntu/home/user/project',
    )
  })
})
