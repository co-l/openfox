/**
 * Periodic task scheduler.
 *
 * Runs the given tick immediately on `start()` (so tasks missed while OpenFox
 * was off fire on next boot) and then on a fixed interval. `stop()` clears the
 * timer so the process can shut down cleanly.
 */

export interface TaskScheduler {
  start(): void
  stop(): void
}

export interface TaskSchedulerDeps {
  run: () => Promise<void> | void
  /** Tick cadence in ms. Defaults to 30s. */
  intervalMs?: number
}

export function createTaskScheduler(deps: TaskSchedulerDeps): TaskScheduler {
  const intervalMs = deps.intervalMs ?? 30_000
  let timer: ReturnType<typeof setInterval> | null = null

  return {
    start() {
      if (timer) return
      void deps.run()
      timer = setInterval(() => void deps.run(), intervalMs)
      // Never keep the process alive just for the scheduler.
      timer.unref?.()
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}
