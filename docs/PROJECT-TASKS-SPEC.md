# Project Tasks — Product Specification

> Status: accepted for implementation
> Scope: user experience in the OpenFox context. Describes features and behavior, not implementation details.

## 1. Purpose & Goals

Replace the "what's next" scratchpad — a physical note on the desk — with a first-class, project-scoped task board living inside OpenFox. The board IS the new scratchpad: ideas, bugs, and chores captured digitally. There is nothing to migrate — the board starts empty and simply takes over the scratchpad's role.

Goals:

- Capture ideas, bugs, and chores as tasks, attached to the project that owns them.
- Provide a classic three-column kanban flow: To Do → In Progress → Done.
- Treat agents as first-class participants with full parity to the human: they can create, update, and move tasks, and their work on a task is tied to a concrete session.
- Support **column gates** ("definition of done") so a task only advances when the required proof exists — verified and produced by the agent, with the human able to revert anything.
- Keep the human as the ultimate owner: every automated action is visible, reversible, and audited.

## 2. Terminology

- **Task** — a unit of work on the board (this feature). Distinct from a session's internal "todo" list (agent subtasks shown in a session message). "Task" in this spec always means a project task.
- **Board / Tasks modal** — the three-column kanban view.
- **Open task** — a task in To Do or In Progress (not Done).
- **Claimed / bound task** — a task linked to a session.
- **Gate** — a named requirement with a description of acceptable proof that blocks a column transition until satisfied.
- **Slot** — a unit of the parallel-session capacity. A launched In Progress task occupies one slot.

## 3. Storage & Scope

- Tasks are **scoped to a project**: each project has its own board. Boards never mix across projects.
- Tasks are **stored locally** in OpenFox's private storage — deliberately invisible to git. The board does not leak into the repository, does not create merge conflicts, and follows the user's machine like sessions and projects do.
- The board survives server restarts and is fully owned by the server (single source of truth). All connected clients render what the server sends.
- There is no cross-project aggregation, export, or sharing in scope.

## 4. Entry Points

### 4.1 Header button

On project pages, a **Tasks** button sits in the header, immediately to the left of the terminal toggle button (same icon cluster, same placement rules).

- Opens the Tasks modal centered over the current view.
- Shows a small **count badge** of open tasks (Backlog + To Do + In Progress + Review) so the board is visible at a glance even when the modal is closed.
- Accessible via keyboard; standard modal dismissal (Esc, click outside, close button).

### 4.2 "Work on next task" on an empty chat feed

When a session has an **empty chat feed** (no messages yet) and there is **at least one open, unclaimed task** in the project, the feed shows a "Work on next task" card above the composer.

- Rationale for "at least one" rather than "more than one": a fresh session with a single open task is precisely the situation where the button is most useful; there is no ambiguity about which task is next.
- The card previews the **next task** — defined as the topmost card in the To Do column (that is not already bound to another session): title, a short excerpt of the prompt, attachment count, and the selected model.
- One click ("Start task") claims that task: it is moved to In Progress, a session is seeded with the task's content (see §7), and the feed transitions from "empty state" to the task's first prompt.
- If every open task is already claimed by another session, the card does not appear.

## 5. The Tasks Modal

### 5.1 Layout & columns

Five columns, classic kanban, left to right, horizontally scrollable within the modal:

- **Backlog** (gray accent) — ideas not yet groomed. New tasks are created here.
- **To Do** — tasks with a prepared planner session, waiting for a human kick-off. Dragging Backlog → To Do only prepares the plan session; it never launches anything and never takes a slot. A "Start plan" button on the card runs the plan workflow on demand.
- **In Progress** — tasks being worked on. Contains both **active** tasks (launched, occupying a slot) and **queued** tasks (waiting for a slot, visually distinct). Tasks without a prior plan run the `plan` builtin workflow first; when a plan already exists, the drag resumes straight into the build phase of the planner session. Carries a hint that moving a card here starts it automatically (§7.2).
- **Review** (violet accent) — the builder stopped here with its work done and gates satisfied, waiting for human inspection. The Gates editor lives on this column header.
- **Done** — completed tasks. Only a human can move a card into Done.

Each column header shows its **count**.

### 5.2 Task cards

Each card shows:

- Title.
- Prompt excerpt (collapsed to one or two lines; expandable on hover/click).
- Attachment indicator (count + thumbnails when images).
- Model chip (the agent/model the task will run with).
- Status badge while in In Progress: **Running** (launched, occupies a slot) or **Queued** (waiting for a slot, position in queue). A card's exact state is always explicit, so the single In Progress column stays unambiguous.
- Session link: an "Open session" button when the task is bound to a session.
- Overflow menu (⋯): Edit, History & evidence, then one entry per other column to move the card directly, and finally Duplicate / Delete. Each destination entry carries a full-height stripe in its exact column color plus a small arrow icon pointing left/right depending on whether the target column sits before or after the current one. No "Move to…" header, no nested fly-out.
- A card in To Do also shows a purple **"Start plan"** button that kicks off the linked planner session (§7.2).

Cards are **draggable** vertically within a column (reorder) and across columns (change state). Keyboard equivalents (menu actions) exist for every drag operation.

### 5.3 Modal chrome (controls)

Fixed header/footer of the modal:

- **Parallel-slot limit** stepper (default **1**, range 1–10) — how many tasks may run concurrently.
- **Queue state** indicator: active count / limit (e.g. `2 / 3`) and the number queued.
- **Pause queue** toggle (§8).
- **Gates** button — opens the Definition of Done editor for the project (§9).
- Board-wide search/filter (by title, free text) — lightweight, no advanced query language.

## 6. Task Editor (create & edit)

Creating or editing a task uses **the exact same composer as the chat input** — not a reduced clone.

Capabilities carried over verbatim:

- Free text prompt with full editor behaviors (drafts, undo, Enter-to-submit / Shift-Enter newline).
- **Slash syntax**: a prompt beginning with `/` resolves against commands and workflows, with inline parameter hints exactly as in chat. A task that starts with a command or workflow executes that command/workflow when its session launches — identical behavior to typing it in chat.
- **Attachments**: paste, drag-and-drop, and file picker, with previews and removal, same formats as chat.
- **@ mentions** for file references.
- **Agent & model selection**: picker defaults to the **default agent**, matching how a new session is configured; the stored selection drives the session the task spawns.

Additional fields on the composer:

- **Title** (short label for the card) — **optional, second-class**. Like sessions, titles are never mandatory: when omitted, one is derived automatically from the prompt (e.g. first line, truncated) so every card still has a label. It can be renamed at any time, from the editor or the card menu.
- Optionally a richer **Description** (long form) in addition to the prompt used for execution.

Validation rules:

- The prompt must contain at least text or one attachment (same emptiness rule as chat send).

### 6.1 Edit semantics

- Editing is available in any state.
- Editing **before** the task is launched is seamless: whatever the task spawns uses the edited content.
- Editing a task **already bound to a running session** updates the task record only; it does **not** mutate the live session or its ongoing generation. An inline note on the editor makes this explicit ("This task is already in progress — changes apply to the next run").
- Draft content of an unsaved edit is preserved if the editor is closed mid-way.

## 7. Lifecycle & States

### 7.1 State machine

```
        (create)
            │
            ▼
      ┌─────────┐                    ┌──────────────────┐
      │ Backlog │ ── drag / move ──► │  To Do           │
      └─────────┘   (prepares plan    └────────┬─────────┘
                    session, idle)     start plan (button)
                                                 │ drag / agent move
                                                 ▼
                                        ┌──────────────────┐
                                        │  In Progress     │
                                        │  ├ active (slot) │
                                        │  └ queued        │
                                        └────────┬─────────┘
                              gates met          │  builder finishes → review
                                                 ▼
                                        ┌──────────┐   human only   ┌────────┐
                                        │  Review  │ ─────────────► │  Done  │
                                        └──────────┘                └────────┘
                                             ▲                           │
                          revert (always allowed) ◄──────────────────────┘
```

Transitions are **enforced server-side** — no client or agent can bypass a gate by acting "smart". A drag is never refused for ordering reasons; the server materializes whatever side effects each destination requires.

### 7.2 Backlog → To Do (plan preparation) and To Do → In Progress (launch rules)

- **Backlog → To Do** creates (or reuses) a planner session linked to the task but **inactive**: never launched, never queued, never occupies a slot, unaffected by Pause queue. The card shows a **"Start plan"** button which runs the builtin `plan` workflow in that session (explore → questions → acceptance criteria → improved prompt → propose In Progress). A plan never auto-starts on this transition.
- Dragging a card to In Progress **claims it**: a new session is created, seeded with the task's title, prompt, attachments, and stored model, then the session opens (user is navigated to it).
- If a plan was already executed for the task (a linked planner session holds acceptance criteria), the plan phase is **skipped**: the drag resumes the planner session itself directly into the build workflow — same session, same context and criteria.
- Without a prior plan, the launched session runs the `plan` workflow first; when the plan settles and its auto-launch countdown elapses (or the user confirms early), the build phase chains in automatically. The chain only stops for genuinely blocking user questions.
- The prompt is preceded by a situational reminder so the agent starts oriented (§11).
- If slots are free, the task launches immediately.
- If the limit is reached, the card drops into **queued** state at the top of In Progress (marked "Queued · N") and launches automatically when a slot frees (§8).
- The In Progress column carries a persistent hint that moving a task into it starts it automatically ("Moving a task here starts it automatically") — the transition is never silent.

### 7.3 Session binding — user vs agent

Two distinct paths converge on the same "task ↔ session" link:

- **Human drag** (or "Start task"): creates a **new** session for that task.
- **Agent move to In Progress**: binds the task to the **current session** — the agent never spawns a new session for itself. This is the important rule: an agent mid-conversation that pulls a task in keeps working in the same session, exactly as if the human had typed the task.

Both paths produce the same linked-card state, the same "Open session" button, and the same situational reminder.

### 7.4 In Progress behaviors

- The card always shows a link to its bound session ("Open session"), which re-opens that session from anywhere in the app.
- Task ↔ session links are never removed implicitly; sessions are never deleted in OpenFox, so the link never dangles. Links are only broken by explicit user action (revert to To Do, delete). Over time a task may carry multiple session links: the active working session plus previous attempts kept as history (§7.5).
- Moving a task back to To Do unbinds it and **frees its slot** immediately (the session itself is untouched; it simply no longer represents this task).
- If the task's session is left idle without reaching Done, the task remains active and keeps its slot — a strict, predictable WIP limit.

### 7.5 → Review → Done

- Transitioning to **Review** runs the **gate check**. If required gate fields are unsatisfied, the move is refused with an actionable message: which fields are missing and what acceptable proof looks like.
- Chosen model: **agent stops at Review** — when the builder finishes with gates satisfied it moves the task to Review; an agent attempting `move(..., "done")` is refused ("only the user can complete a task"). The human reviews the evidence, then drags (or menus) the card to Done.
- The human can **revert** any Review/Done task back to In Progress or To Do at any time, optionally attaching a short reason. Reverts are recorded in the task's audit trail (§10.4).
- **Re-opening** a Review/Done task (moving it back to In Progress) creates a **fresh session** for the new attempt; the previous attempt's session stays linked to the task as history, not as the active work session.

### 7.6 Delete

- Delete is available from the card menu (and to agents via the tool).
- Deleting asks for confirmation.
- Deleting **unlinks** the task from its session(s) but never deletes any session or its history.

## 8. Parallelism & Queue

- The parallel-slot limit is set in the modal (default **1**, range 1–10) and governs how many tasks run at the same time.
- **A slot is occupied** by an active (launched) In Progress task.
- **A slot frees only when its task reaches Done**, or when the task is moved back out of In Progress. Session closure does not free a slot — sessions persist by design, and an unfinished task legitimately retains its slot until resolved.
- When a slot frees, the **next queued task auto-launches** (FIFO): a session is seeded and a notification appears with an "Open session" button. No manual kick needed.
- **Pause queue** toggle in the modal pauses auto-launch; queued tasks stay queued until unpaused, without affecting the tasks already running.
- Queued tasks show their position ("Queued · 2") so the wait is legible.

## 9. Column Gates (Definition of Done)

- Gates are a **per-project configuration** edited in the modal ("Gates", on the Review column header → "Definition of Review").
- A gate is a named requirement with a **description of acceptable proof**, e.g. "all green" (all acceptance criteria pass with evidence) or "commit" (work committed with a commit reference). Names and labels are illustrative, not prescriptive.
- Gates define what a task must carry before it may enter **Review** ("Blocks Review"). (Gates guarding the In Progress boundary — a "definition of ready" — are a supported variant of the same mechanism, off by default.) Storage keys are unchanged (`done` / `ready` variants); only the labels were renamed with the Review column.
- Each task carries **values** for the required fields. Values are set by the human (via the modal) or by the agent (via the tool, filling proof/evidence as part of its work).
- Every value records **who set it and when** (actor + timestamp), and the audit trail is visible on the card/modal — the human can always see what evidence drove a Done transition.

### 9.1 Blocked-move experience

When a move toward Review hits a gate gap:

- **For the human:** the drag is refused with an inline notice on the card listing the missing fields and what counts as acceptable proof, plus a shortcut to fill them.
- **For the agent:** the move call returns a structured error naming the missing fields and exactly what to do first (e.g. "use project_tasks reqs to set field 'commit' with a commit SHA before calling move again"). The agent can then fill the fields and retry — this is the intended loop, not a dead end.

## 10. Agent Participation (`project_tasks`)

A `project_tasks` tool is available to the built-in Planner and Builder agents (and to any sub-agent or custom agent that opts in).

Behavioral contract:

- **Full parity with the human**: the agent can list, create, edit, move, fill gate fields, duplicate, and delete tasks — every capability the modal offers.
- **Per-action permissions**: the tool is granted granularly per action (e.g. list-only agents exist); denying an action to an agent denies only that action, not the whole tool.
- **The current-session rule** (§7.3) is non-negotiable: an agent's `move(..., "in_progress")` binds to the session it is executing in. It can never create sessions on its own through this tool.
- **Gates are server-enforced**: the agent cannot move past a gate it didn't satisfy, no matter how it phrases the call. It receives the actionable gate error (§9.1) and completes the loop by setting the required fields.
- **Concurrent access** is safe: two agents (or an agent and the human) acting on the same task cannot clobber each other — transitions serialize, and conflicting operations return a clear "task changed, refresh and retry" style error rather than corrupting state.
- The agent always sees the same gate configuration and audit history as the human, so its judgment and the human's review operate on identical facts.

### 10.1 What the agent sees

The tool surfaces, per task: title, description/prompt, attachments, current state, queue position, bound session, model, gate values and status, and the audit trail. It reads the same facts the modal renders, one page at a time.

The `list` action is paginated to keep agent context lean: it returns at most 10 tasks by default (max 25 via `limit`, `offset` for paging) plus a `total` and `hasMore` flag, so the agent pages through large boards instead of loading everything at once. Pages are snapshots of the board at call time — re-list after any mutation for a fresh, consistent view.

## 11. Situational Reminders

Task state changes emit a **system reminder** into the affected session's feed — the same mechanism as switching workspace — so the agent is always situated without having to be told in the prompt.

Mechanics (mirroring the workspace-switch reminder):

- The reminder is injected as a system-marked message in the session history (distinct "system" styling in the feed), wrapped in `<system-reminder>` tags so it reads as environment context, not user speech.
- It carries task-specific metadata (type `task`, distinct identity from workspace reminders) so the feed can render and group it appropriately.

Emission rules:

- **→ In Progress (human drag / Start task):** the reminder lands in the newly created session, positioned as its opening context _immediately before_ the task prompt. The agent's first sight is: which task it is working on, from which board, with which gates ahead.
- **→ In Progress (agent move):** the reminder lands in the agent's current session, confirming "this session is now working on task X", its state, and outstanding gates.
- **→ Review (agent finish / human drag):** the reminder lands in the task's bound session, stating the work stopped for human review and summarizing the gate evidence — so a still-active agent winds down cleanly instead of continuing.
- **→ Done (human only):** moving to Done is refused for agents ("move to Review instead"); a human completing a task lands the confirmation reminder in any linked session.
- **→ To Do (revert / unbind):** the reminder notes the task is no longer active in this session, preventing a resumed agent from chasing a dead assignment.

Reminder content always includes: task title, previous → new state, and (relevant) the remaining or satisfied gate requirements.

## 12. Real-Time Consistency

- The server owns all task state. Whatever a human does in the modal or an agent does via the tool is broadcast to all connected clients for that project, so open modals update live (no manual refresh, no stale boards).
- Streamed/pushed task state and state fetched on open are **identical in shape** — the modal renders one code path regardless of how data arrived (streaming/fetch parity).
- The agent's view (tool) and the human's view (modal) can never disagree: both read the same server truth.

## 13. Edge Cases

- **Move to In Progress with zero free slots** → queued (not failed), with visible position.
- **Agent moves a task while the human is viewing it** → live update in the modal (§12).
- **Editing a task whose session already started** → task updated; live session unaffected; editor says so (§6.1).
- **Task moved back to To Do mid-flight** → session unbinds, slot frees, no orphaned "active" state.
- **Done task re-opened** → fresh session for the new attempt; prior sessions remain as history (§7.5).
- **Gates reconfigured after tasks have progressed** → new rules apply at the next attempted move; historical evidence is retained in the audit trail.
- **Parallel agents racing on one task** → serialized transitions, clear refresh-and-retry error (§10).
- **Task created with only an attachment and no text** → valid, same emptiness rule as chat.
- **Deleted task previously linked to sessions** → unlinks; sessions and their histories remain intact (§7.6).

## 14. Non-Goals

- No cross-project boards or global task inbox.
- No priorities, deadlines, assignees, tags, or estimates — ordering in the column is the only ranking.
- No integration with external issue trackers (GitHub issues, Linear, etc.).
- No change to OpenFox's session lifecycle (sessions are never deleted; task features build on that).
- No team sharing via the repo — the board is intentionally private to the local install (§3).

## 15. Nice-to-Haves / Future

- Manual "Start now" override that temporarily exceeds the slot limit (with a warning).
- Gate templates (bundled common definitions of done) for one-click setup.
- Board filters per gate status (e.g. "all tasks blocked on commit").
- Export/archive of the Done column to a Markdown changelog.
