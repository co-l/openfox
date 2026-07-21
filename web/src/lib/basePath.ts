function detectBasePath(): string {
  if (typeof document === 'undefined') return ''

  const script = Array.from(document.scripts).find((item) => {
    const path = new URL(item.src, window.location.href).pathname
    return path.includes('/assets/') || path.endsWith('/src/main.tsx')
  })

  if (!script) return ''

  const path = new URL(script.src, window.location.href).pathname
  const marker = path.includes('/assets/') ? '/assets/' : '/src/'
  const markerIndex = path.indexOf(marker)
  return markerIndex > 0 ? path.slice(0, markerIndex) : ''
}

export const appBasePath = detectBasePath()

export function appUrl(path: string): string {
  if (!path.startsWith('/')) return path
  return `${appBasePath}${path}` || '/'
}
