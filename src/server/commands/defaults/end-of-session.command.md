---
id: end-of-session
name: End of Session
agentMode: builder
---

End-of-session routine: the user asked to close this session. Summarize it, then report the findings worth keeping. Do NOT delete anything and do NOT start new work.

### Steps

1. **Summarize** the session in 5-10 factual lines: what was achieved, files/hosts touched, decisions made and why, current state of the work.

2. **Verify commits**: `git status` plus `git log @{u}..HEAD` — every change this session created should be committed and pushed. If not, commit and push this session's own changes (stage only what this session created). Report anything left uncommitted and why.

3. **Mine learnings** — review the ENTIRE session above (user messages, reasoning, tool calls) for durable, reusable knowledge: gotchas and the fixes that worked, environment facts, conventions and preferences the user expressed, working commands/recipes. Exclude ephemeral one-offs, things already documented, and secrets (reference their location instead).

4. **Persist** each durable learning where it belongs:

   - **Project memory** — append a terse line to `<project-root>/AGENTS.md` (dedupe first: skip facts already there) and prepend a dated entry to `<project-root>/Changelog.md` when user-visible state changed.

   - **Machine-global memory** — a fact that outlives this repository (an environment quirk, a working command, a user preference) belongs in OpenFox's own global instructions, which are a line database on its API. Reach the server that owns this session:

     ```bash
     BASE=${OPENFOX_API:-http://127.0.0.1:${OPENFOX_PORT:-10369}}
     curl -s  "$BASE/api/settings/global_instructions"                                          # read the lines
     curl -s -X POST   "$BASE/api/settings/global_instructions"  -H 'Content-Type: application/json' -d '{"line":"- <fact>"}'
     curl -s -X PATCH  "$BASE/api/settings/global_instructions"  -H 'Content-Type: application/json' -d '{"match":"- <old line>","line":"- <new line>"}'
     curl -s -X DELETE "$BASE/api/settings/global_instructions"  -H 'Content-Type: application/json' -d '{"line":"- <obsolete fact>"}'
     ```

     Read first and dedupe — `POST` reports `changed:false` when the line is already there. Send one line per call; `PATCH`/`DELETE` name the line they mean (no numbering) and answer 404 with `matched: 0` when nothing matches. Never rewrite the whole value, never PUT it, and never edit the `settings` row in SQLite: the verbs exist precisely so that adding one fact cannot damage the rest.

   - Do NOT touch credential stores, other repositories, or any other setting from this routine.

5. **Report** what was persisted in the same numbered table the global routine uses, so both variants read alike:

   | #   | Retained             | Store                             |
   | --- | -------------------- | --------------------------------- |
   | 1   | <the fact, one line> | `<project-root>/AGENTS.md`        |
   | 2   | <the fact, one line> | global instructions (`API: POST`) |

   List anything skipped as a duplicate separately (below the table), plus what is still outstanding. Then stop — the user confirms the delete from the chat.
