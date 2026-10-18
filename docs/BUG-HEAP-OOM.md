# JavaScript Heap OOM — Root Cause Analysis

This document explains precisely why the OpenFox server crashed with
`FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`
after ~10 hours of continuous uptime.

## Symptom

```
[pid] 36204982 ms: Mark-Compact 8062.8 (8217.9) -> 8062.0 (8233.9) MB, ...
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

Key facts from the crash:

- The process died after **~10 hours** (36 204 982 ms), not on a single spike.
- The heap was pinned at **~8 GB** and could not be reclaimed by garbage collection
  (`scavenge might not succeed`), which is the signature of **live objects that the GC
  cannot free** — i.e. a leak, not a transient allocation burst.

## Why the ceiling was exactly 8 GB

The heap limit is not V8's default. The CLI wrapper caps it explicitly in
`src/cli/index.ts` (and `src/cli/dev.ts`):

```ts
const DEFAULT_HEAP_MB = 8_192
// effective = min(8192, max(4096, 55% of total RAM))
```

The value is injected via `execArgv` (`--max-old-space-size`) on process restart. So on a
machine with enough RAM the ceiling is exactly **8192 MB**, which is what the crash hit.

## Root cause #1 (primary): unbounded background-process log buffers

The `background_process` tool spawns long-lived child processes (dev servers, test
watchers, build watchers, monitoring loops) and captures their `stdout`/`stderr`.

Every output chunk was appended to an **in-memory, unbounded array**:

- `src/server/tools/background-process/store.ts`
  - `logsByProcess: Map<processId, LogLine[]>`
  - `appendLog()` did `logs.push(...)` with **no line or byte cap**.

Two properties made this the dominant leak:

1. **No cap at all.** The dev-server log buffer
   (`src/server/dev-server/manager.ts`) is bounded to `MAX_LOG_LINES = 2000` /
   `MAX_LOG_BYTES = 100_000` and trims the oldest entries. The background-process buffer
   had no equivalent limit — a chatty process (e.g. `vitest --watch`, a dev server with
   HMR logs, a `while true; do echo; done` loop) accumulates raw output in the heap
   indefinitely.

2. **Logs were never freed on natural exit.** The only code path that removed a buffer
   was `removeProcess()`, called exclusively from the _manual_ `stopProcess()` action.
   When a child process ended on its own (`child.on('exit')` in
   `src/server/tools/background-process/manager.ts`), the process and its entire log
   buffer stayed in `processesBySession` / `logsByProcess` **forever**.

Because these buffers grow _within a single long-running session_, one long-lived chatty
process is enough to push the heap from a few hundred MB to 8 GB over hours. This is the
main contributor to the crash.

## Root cause #2 (contributing): per-session registries never cleaned up

When a session is deleted, `SessionManager.deleteSession()` (in
`src/server/session/manager.ts`) clears some per-session maps but **forgot several others**.
Each created-then-deleted session therefore left live entries behind. Over 10 hours of
usage (many sessions), these add up:

| Location                            | Leaked per deleted session                                                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/ws/server.ts`           | `sessionLLMClients` — one cached LLM client per session (only cleared when the provider changed, never on delete)                                                                                               |
| `src/server/tools/path-security.ts` | `sessionAllowedPaths` — the user-approved path allowlist (`clearAllowedPaths()` was never called in production code)                                                                                            |
| `src/server/session/manager.ts`     | `readFilesCache`, `debugDumpStore` (full prompt string + tool arrays — the largest per entry), `dynamicContextChangedStore`, `subAgentContextSizes`, `activeSubAgents`, `switchLocks`, `workspaceCreationLocks` |
| `src/server/events/store.ts`        | `subscribers` — an empty `Set` left behind after the last subscriber unsubscribed                                                                                                                               |

Unlike root cause #1, this grows with the **number of sessions created** over the server's
lifetime rather than within one session. It is a secondary contributor but compounds the
total.

## Why it took ~10 hours

Neither root cause is a fast leak:

- Root cause #1 grows proportional to output volume of a single long-lived process
  (tens to hundreds of MB over hours, not seconds).
- Root cause #2 grows a little per session.

Together they produce a slow, monotonic heap climb that GC cannot reverse. The heap
crosses the 8 GB ceiling only after enough time — hence the ~10-hour delay between server
start and the fatal OOM.

## The fix

- **Bound the background-process log buffer** to 2 000 lines / 100 KB (oldest dropped),
  matching the dev-server policy exactly. Byte accounting uses `Buffer.byteLength` (real
  UTF-8 bytes, not code units). `store.appendLog`, `store.removeSession`.
- **Clean up on session delete**: `deleteSession()` now kills the session's running
  background process trees (`stopSessionProcesses`), clears the background-process maps,
  clears `sessionAllowedPaths`, and clears all the SessionManager per-session maps above.
  The WS server releases the cached LLM client on the `session_deleted` event, and the
  EventStore removes empty subscriber sets.
- **Add a memory watchdog** (`src/server/memory-watchdog.ts`) that samples
  `process.memoryUsage()` every minute and warns (30-min cooldown) when heap usage exceeds
  75% of the limit or grows ≥ 100 MB over 30 minutes. It is observation-only (logs, does
  not restart) so a future slow leak is visible in logs _before_ it becomes a fatal OOM.

## How to verify the fix

- **Memory stays flat**: run a chatty background process (e.g. a `while true; do echo; sleep 0.1; done`
  loop) and watch the server's RSS — it no longer climbs without bound, and deleting the
  session releases the buffer.
- **Logs are bounded**: a process emitting >2 000 lines keeps at most 2 000 / 100 KB in
  memory; oldest lines are dropped.
- **No per-session growth**: create/delete many sessions repeatedly and confirm the server's
  RSS returns to baseline.
- **Watchdog visible**: in dev mode, a `Memory watchdog sample` debug line appears every
  minute; warnings appear only under real pressure.
