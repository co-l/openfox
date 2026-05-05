export function KvCacheWarning() {
  return (
    <div className="flex items-start gap-2 px-3 py-2 mt-3 bg-accent-warning/10 border border-accent-warning/30 rounded text-xs">
      <span>⚠️</span>
      <p className="text-text-secondary">
        Editing this value now will have the side-effect of invalidating KV-cache, causing your next message in current
        sessions to take a long time to process. Consider doing this between sessions.
      </p>
    </div>
  )
}
