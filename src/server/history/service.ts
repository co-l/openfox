import { ensureDirectory } from './history.snapshot.js'
import type { HistoryConfig } from './history.config.js'
import { loadConfig } from './history.config.js'
import { startCleanupScheduler } from './history.retention.js'
import { FileWatcher } from './history.watcher.js'

export interface HistoryServiceHandle {
  stop(): void
}

export async function startHistoryService(
  workdir: string,
  options?: { onWatcherError?: (error: unknown) => void }
): Promise<HistoryServiceHandle> {
  const snapshotDir = `${workdir}/.openfox/history`

  await ensureDirectory(snapshotDir)

  const config = await loadConfig(workdir)
  const cleanupTimer = startCleanupScheduler(snapshotDir, config)
  const watcher = new FileWatcher(workdir, snapshotDir, config.excludePatterns)

  if (options?.onWatcherError) {
    watcher.onError = options.onWatcherError
  }

  await watcher.start()

  return {
    stop(): void {
      watcher.stop()
      clearInterval(cleanupTimer)
    },
  }
}

export type { HistoryConfig }
