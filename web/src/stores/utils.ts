export function createLogBuffer(flushFn: () => void) {
  let logRafId: number | null = null

  function scheduleLogFlush() {
    if (logRafId !== null) return
    logRafId = requestAnimationFrame(() => {
      logRafId = null
      flushFn()
    })
  }

  return scheduleLogFlush
}
