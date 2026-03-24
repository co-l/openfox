import { startHistoryService } from './service.js'

async function main(): Promise<void> {
  const workdir = process.argv[2]

  if (!workdir) {
    throw new Error('Missing workdir argument for history process')
  }

  let stopped = false

  let service = null as Awaited<ReturnType<typeof startHistoryService>> | null

  service = await startHistoryService(workdir, {
    onWatcherError: (error) => {
      if (stopped) {
        return
      }

      stopped = true
      console.error('History process watcher failed', { workdir, error })
      service?.stop()
      process.exitCode = 1
      process.exit()
    },
  })

  const shutdown = () => {
    if (stopped) {
      return
    }

    stopped = true
    service.stop()
    process.exitCode = 0
    process.exit()
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught history process error', error)
  process.exit(1)
})

process.on('unhandledRejection', (error) => {
  console.error('Unhandled history process rejection', error)
  process.exit(1)
})

void main().catch((error) => {
  console.error('Failed to start history process', error)
  process.exit(1)
})
