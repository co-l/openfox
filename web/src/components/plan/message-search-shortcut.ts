export function shouldCaptureMessageSearchShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'f' &&
    document.querySelector('[data-global-settings]') === null
  )
}
