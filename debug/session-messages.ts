import Database from 'better-sqlite3'

const dbPath = '/home/conrad/.local/share/openfox/sessions.db'

const sessionId = process.argv[2]
if (!sessionId) {
  console.error('Usage: tsx debug/session-messages.ts <session_id>')
  process.exit(1)
}

const db = new Database(dbPath)

const stmt = db.prepare(`
  SELECT payload FROM events 
  WHERE session_id = ? AND event_type = 'turn.snapshot' 
  ORDER BY seq DESC LIMIT 1
`)

const row = stmt.get(sessionId) as { payload: string } | undefined
if (!row) {
  console.error('Session not found or no turn.snapshot events')
  process.exit(1)
}

const data = JSON.parse(row.payload)
const messages = data.messages ?? []

const last10 = messages.slice(-10).map((m: {
  role: string
  content?: string
  thinkingContent?: string | null
  segments?: Array<{ type: string; content?: string }>
}) => ({
  role: m.role,
  content: m.content ?? '',
  thinkingContent: m.thinkingContent,
  segments: m.segments ?? []
}))

console.log(JSON.stringify(last10, null, 2))