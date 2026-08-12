---
name: workflows
description: 'Author and manage OpenFox workflow files (.workflow.json): step types, transition conditions, template variables, and storage locations.'
metadata:
  version: 1.0.0
  openfox:
    displayName: Workflows
---

# OpenFox Workflows — Authoring Reference

Authoritative reference for creating and editing OpenFox workflow files (`.workflow.json`).
Executor implementation: `src/server/workflows/` (`types.ts`, `executor.ts`, `registry.ts`)
and `src/server/routes/workflows.ts`.

A workflow is a declarative **state machine**: a sequence of steps (agent turns, sub-agent
calls, shell commands, user pauses) wired together by **transitions** with **conditions**.
The executor walks the graph until it reaches a terminal state (`$done` or `$blocked`).

When a user asks you to create or edit a workflow, follow this document.

---

## 1. Storage Locations & Precedence

Workflows are plain JSON files with extension `.workflow.json` (never markdown). Three
tiers, merged **by `metadata.id`** with later tiers overriding earlier ones:

| Tier        | Location                                                                                 | Notes                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Default** | `src/server/workflows/defaults/{id}.workflow.json` (bundled → `dist/workflow-defaults/`) | Ships with the product. Not editable, not deletable.                                       |
| **User**    | `{configDir}/workflows/{id}.workflow.json`                                               | Per-user, machine-local.                                                                   |
| **Project** | `{projectDir}/.openfox/workflows/{id}.workflow.json`                                     | Committed to the repo, shared with the team. **Recommended for agent-authored workflows.** |

**Precedence (highest wins):** `project > user > default`. A project workflow with the same
`metadata.id` as a bundled default replaces it everywhere.

**Config dirs:** production `~/.config/openfox/`, development `~/.config/openfox-dev/`
(other platforms: `XDG_CONFIG_HOME`/`~/.config` on Linux, `~/Library/Application Support`
on macOS, `%APPDATA%` on Windows).

**Filename convention:** `{id}.workflow.json` — the loader keys on the embedded
`metadata.id` (any `*.workflow.json` is read), but every writer uses the ID as the
filename, so keep them in sync: one workflow per file. `id` is a lowercase slug
`[a-z0-9-]` (e.g. `build-test-fix`).

**Minimum validity** (files failing this are **silently skipped** with a warning — no hard
error at startup): `metadata.id` is set **and** `steps` is a non-empty array. Malformed
JSON is also skipped.

**API surface:** CRUD routes at `/api/workflows` (`src/server/routes/workflows.ts`) — list,
get/create/update/delete, duplicate, template-variables. Creating via file is preferred for
agent-authored workflows because the file is reviewable and committable.

---

## 2. Overall Shape

```jsonc
{
  "metadata": {
    "id": "build-test-fix",
    "name": "Build → Test → Fix",
    "description": "Loop: build, run tests, fix failures.",
    "version": "1.0.0",
    "color": "#3b82f6", // optional, UI accent
    "parameters": [
      // optional, prompted at launch
      {
        "id": "feature",
        "label": "Feature name",
        "description": "What to implement",
        "position": 0, // optional, ordering
        "required": true, // optional, default false
      },
    ],
  },
  "entryStep": "build", // ID of the first step to execute
  "settings": {
    "maxIterations": 50, // safety cap on state-machine iterations
  },
  "steps": [/* see §3 */],
  "startCondition": { "type": "always" }, // optional, gates workflow start
}
```

### Field reference

| Field                    | Type                  | Required | Description                                                                                  |
| ------------------------ | --------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `metadata.id`            | string                | yes      | Unique slug; filename stem. Lowercase `[a-z0-9-]`.                                           |
| `metadata.name`          | string                | yes      | Human-readable display name.                                                                 |
| `metadata.description`   | string                | yes      | What the workflow does.                                                                      |
| `metadata.version`       | string                | yes      | Semver-ish version string.                                                                   |
| `metadata.color`         | string                | no       | Hex color for UI badges.                                                                     |
| `metadata.parameters`    | `WorkflowParameter[]` | no       | User inputs requested at launch (see §6).                                                    |
| `entryStep`              | string                | yes      | ID of the step the workflow starts at.                                                       |
| `settings.maxIterations` | number                | yes      | Hard cap on executor loop iterations. Exceeding it ⇒ `BLOCKED`. Default in the editor is 50. |
| `steps`                  | `WorkflowStep[]`      | yes      | Non-empty. Order is display-only — execution follows transitions.                            |
| `startCondition`         | `TransitionCondition` | no       | Gates workflow start on session metadata (default: `always`).                                |

---

## 3. Steps

Every step shares these base fields:

| Field         | Type           | Required | Description                                                                                        |
| ------------- | -------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `id`          | string         | yes      | Unique within the workflow. Referenced by `entryStep`, `goto`, `{{stepOutput.id}}`.                |
| `name`        | string         | yes      | Display name.                                                                                      |
| `phase`       | string         | yes      | Maps to the session phase for UI: `"build"`, `"verification"`, `"waiting"`, `"blocked"`, `"done"`. |
| `transitions` | `Transition[]` | yes      | Evaluated **in order, first match wins**. See §4.                                                  |
| `subGroup`    | string         | no       | Groups steps for running a subset in isolation. See §7.                                            |

### 3.1 `agent` — full LLM turn with tools

```jsonc
{
  "id": "implement",
  "name": "Implement",
  "type": "agent",
  "phase": "build",
  "agentId": "builder", // optional, default: resolved default agent (usually "planner")
  "prompt": "Implement {{criteriaCount}} criteria…",
  "nudgePrompt": "Keep going. {{reason}} …", // optional, injected on re-entry
  "transitions": [/* … */],
}
```

- Runs a full agent turn (LLM + tool loop) with the agent's tool registry.
- `agentId` defaults to the resolved default agent: DB setting → global config →
  `OPENFOX_DEFAULT_AGENT` env → `"planner"`. Common values: `"builder"`, `"planner"`.
- `prompt` is injected as a user message **on first entry**, with
  `"\n\nOnce you're done, call step_done()"` appended. Supports template variables (§6).
- **Advance rule:** the step only advances after the agent calls **`step_done()`**
  successfully. If it finishes without `step_done()`, the executor **loops back to the
  same step** and injects a nudge (`nudgePrompt` if present, plus a `step_done()` reminder).
  If no `prompt` is set and it's the first entry, a generic kickoff
  ("Proceed with the current step.") is injected.
- **Result:** if the agent uses `return_value` (with `result` and/or `content`), those
  become the step's `result` and `stepOutput`; otherwise the result defaults to
  `"completed"`. `stepOutput.stepDoneCalled` is `"true"`/`"false"`.

### 3.2 `sub_agent` — isolated sub-agent with fresh context

```jsonc
{
  "id": "verify",
  "name": "Verifier",
  "type": "sub_agent",
  "phase": "verification",
  "subAgentType": "verifier", // required — any configured sub-agent type
  "prompt": "## Criteria\n{{criteriaList}} …",
  "nudgePrompt": "…", // declared in the schema
  "transitions": [/* … */],
}
```

- Runs one isolated sub-agent turn (fresh context). The `step_done` tool is **removed**
  from sub-agents.
- `prompt` defaults to `"Perform your task."` if omitted.
- Unknown `subAgentType` ⇒ the step resolves with `result: "error"`.
- **Result:** the sub-agent's `return_value` `result`, or `"success"` if none. Content
  lands in `{{stepOutput.content}}`.

### 3.3 `shell` — run a command, branch on exit code

```jsonc
{
  "id": "lint",
  "name": "Lint",
  "type": "shell",
  "phase": "verification",
  "command": "npm run lint",
  "timeout": 90000, // optional, ms, default 60000
  "successExitCodes": [0], // optional, default [0]
  "transitions": [/* … */],
}
```

- `command` runs in the session workdir and supports template variables (§6).
- **Result:** `"success"` if the exit code is in `successExitCodes`, else `"failure"`.
- `stepOutput`: `stdout`, `stderr`, `exitCode` (string).
- The command and its output (truncated to 10k chars) are echoed into the chat as system
  messages.

### 3.4 `user` — pause for a human decision

```jsonc
{
  "id": "approve",
  "name": "Approve Fix Plan",
  "type": "user",
  "phase": "verification",
  "transitions": [
    { "when": { "type": "step_result", "result": "apply" }, "goto": "apply_fixes" },
    { "when": { "type": "step_result", "result": "skip" }, "goto": "start_dev_server" },
    { "when": { "type": "always" }, "goto": "apply_fixes" },
  ],
}
```

- Pauses the workflow and presents **buttons derived from the transitions**:
  - each `step_result` transition ⇒ one choice button (its `result` string is both the id
    and the label);
  - an `always` transition ⇒ a `"Continue"` button (`id: "continue"`).
- On resume, the picked choice becomes the step's `result`; the chosen button's `goto`
  drives the next transition. Selecting "Continue" (or resuming without an explicit choice)
  yields the reserved result `"continue"`, which matches an `always` transition.
- Use this for approvals, plan sign-off, manual QA gates, etc. Only `step_result` and
  `always` transitions matter for choices; other conditions are ignored when deriving
  buttons.

---

## 4. Transitions & Conditions

Each step carries an ordered `transitions` array. The executor evaluates them **in order
and takes the first whose `when` matches**. If none matches, the workflow goes `$blocked`
("Runner blocked: No matching transition").

```jsonc
{ "when": { /* condition */ }, "goto": "next_step_id" | "$done" | "$blocked", "subGroup": "optional" }
```

- `goto` is a step `id` or one of the terminal states:
  - `"$done"` — workflow completes (session phase `done`, stats recorded).
  - `"$blocked"` — workflow stops blocked.
- `subGroup` on a transition is only meaningful when running that sub-group (§7).

### Conditions (all four)

| Condition                                                                                               | Matches when                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `{ "type": "always" }`                                                                                  | Always. Use as the final fallback to avoid dead ends.                                                              |
| `{ "type": "step_result", "result": "x" }`                                                              | The current step returned result exactly `"x"` (from `return_value`, shell exit classification, or a user choice). |
| `{ "type": "metadata_all_match", "key": "criteria", "field": "status", "value": "passed" }`             | **Every** session-metadata entry under `key` has `entry[field] === value`.                                         |
| `{ "type": "metadata_all_in", "key": "criteria", "field": "status", "values": ["completed","passed"] }` | Every entry's `field` is **one of** `values`.                                                                      |

Notes on metadata conditions:

- Operate on the session's metadata entries (managed via the `session_metadata` tool),
  keyed by name — common keys: `criteria` (fields `status`, `description`, …) and
  `review_findings` (field `status`: `open`/`resolved`/`dismissed`).
- **Empty entry list ⇒ condition is `true`** (vacuous truth). If there are no criteria at
  all, a `metadata_all_match` on `criteria` passes.
- Evaluated with the **latest** session state after the step executes.

Example — build → test → fix loop:

```
build ──(metadata_all_in status completed|passed)──▶ test
  ▲                                                     │
  └───────────────(always fallback)─────────────────────┘
test ──(step_result "passed")────────────────────────▶ $done
test ──(step_result "failed")────────────────────────▶ fix
fix  ──(always)──────────────────────────────────────▶ test
```

---

## 5. Runtime Semantics (authoring-critical)

- **`step_done()` is mandatory for agent steps.** Without it, the step loops back on itself
  with nudges. Write prompts that explicitly end with "call `step_done()`".
- **Results come from `return_value`** (`result`, `content`). Branch on `step_result`
  conditions. Shell steps produce `success`/`failure` from exit codes; sub-agents default
  to `success`; agent steps default to `completed`.
- **`maxIterations` caps the whole workflow**, not individual steps. Tight loops +
  `always` self-transitions can burn it fast. Escape loops with `step_result` /
  `metadata_*` conditions.
- **Blocking:** no matching transition ⇒ `$blocked`. `startCondition` unmet ⇒ blocked
  before the first step. Hitting `maxIterations` ⇒ blocked.
- **Abort/resume:** aborting mid-workflow keeps the execution record alive; sending a new
  message resumes from the current step.
- **Phases:** `step.phase` drives the session-phase UI (`build`, `verification`, …) and is
  set as each step runs.
- **Session mode:** agent steps set the session mode to their `agentId`.

---

## 6. Template Variables (prompts, nudges, shell commands)

The named variables below are the canonical list (the API exposes them via
`GET /api/workflows/template-variables`); `{{stepOutput.<key>}}` resolves generically
against the previous step's output map:

| Variable                        | Meaning                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `{{workdir}}`                   | Session working directory                                                                                      |
| `{{reason}}`                    | Human-readable reason (e.g. "N criteria remaining")                                                            |
| `{{criteriaCount}}`             | Total number of criteria                                                                                       |
| `{{pendingCount}}`              | Number of pending/failed criteria                                                                              |
| `{{criteriaList}}`              | Formatted list of all criteria with status (`[PASSED]`, `[NEEDS VERIFICATION]`, `[FAILED]`, `[NOT COMPLETED]`) |
| `{{modifiedFiles}}`             | Git-diff list of files modified this session                                                                   |
| `{{stepOutput.content}}`        | Text output of the previous step (agent/sub-agent `return_value` content)                                      |
| `{{stepOutput.result}}`         | Result string of the previous step                                                                             |
| `{{stepOutput.stdout}}`         | Previous **shell** step stdout                                                                                 |
| `{{stepOutput.stderr}}`         | Previous **shell** step stderr                                                                                 |
| `{{stepOutput.exitCode}}`       | Previous **shell** step exit code                                                                              |
| `{{stepOutput.stepDoneCalled}}` | Whether the previous agent step called `step_done()`                                                           |
| `{{params}}` / `{{someParam}}`  | User-supplied launch parameters (see below)                                                                    |

- `{{stepOutput.<anything>}}` is resolved generically from the previous step's output map;
  unknown keys render empty.
- `{{stepOutput.*}}` refers to the **immediately preceding** executed step in the run (not
  the step that transitioned to the current one via a loop).
- **Parameters:** any `metadata.parameters` entry is collected at launch and injected as
  `{{paramId}}` in prompts/nudges/commands. Parameters resolve last and **cannot override**
  the built-in variables above. Example: the `review` workflow prompts the user for
  `pr_number` and uses `{{pr_number}}` throughout.
- Deprecated aliases: `{{verifierFindings}}` → `{{stepOutput.content}}`,
  `{{previousStepOutput}}` → `{{stepOutput.stdout}}`.

---

## 7. Sub-Groups

A `subGroup` string on a step groups related steps so the workflow can be **run in
isolation as a slice** (e.g. the UI runs just the "code review" group of a larger
workflow):

- Running a sub-group executes **only** steps whose `subGroup` matches, starting at the
  group's first step.
- Only untagged transitions and transitions tagged with the running sub-group (or a
  sub-group already entered via escape) are candidates, evaluated first-match-wins.
- A candidate transition pointing to a step **outside** the active group is treated as
  `$done` (the slice completes) — **unless** it is tagged with an entered sub-group.
  Such a transition **escapes**: its target step is pulled into the slice and executes,
  and the target's own sub-group tag becomes eligible too, so a slice can loop into
  another sub-group and back (e.g. `verify` failure → `build` → `verify` → … →
  all passed → `$done`).

Escaping example from the bundled "Build & Verify" workflow:

- `verify` step: `always → build` tagged `subGroup: "verify"` — lets the "verify" slice
  pull the builder back in on failure.

Untagged transitions keep slices closed: in the "build" slice, the `build` step's
untagged `metadata_all_in → verify` edge is clamped to `$done`, so implementing alone
finishes without escalating into the verifier (verification is the "verify" slice's job).

Because only tagged transitions may leave the slice, a foreign-group-tagged transition
cannot preempt an in-slice one: transitions tagged with a sub-group that was never
entered are not evaluated at all in a slice run.

On a full run, `subGroup` (on steps and transitions) is purely organizational; transition
tags are ignored and every step's transitions apply as written.

---

## 8. Authoring Checklist (do this every time)

1. **Choose scope.** Project workflows go in `.openfox/workflows/` (commit them — they're
   part of the repo contract). User-global workflows go in `{configDir}/workflows/`.
2. **Slug the ID** — lowercase `[a-z0-9-]`, used as filename `{id}.workflow.json` and as
   the override key.
3. **Fill `metadata`** completely: `id`, `name`, `description`, `version`; add `color` and
   `parameters` when useful.
4. **Design the graph:** pick `entryStep`, size `settings.maxIterations` generously but
   sanely, and sketch steps + transitions on paper first.
5. **Give every step** a unique `id`, a readable `name`, and a `phase`.
6. **Agent steps:** write a concrete `prompt`, end it with "call `step_done()`", and use
   `return_value` (with distinct `result` strings) wherever downstream steps branch on
   outcome. Add `nudgePrompt` for retries when useful.
7. **Transitions:** order them so specific conditions come first, and **always end with an
   `always` fallback** to prevent `$blocked` dead ends.
8. **Insert `user` steps** for anything needing a human gate (approvals, test sign-off).
9. **Validate:** the file must be valid JSON with `metadata.id` + non-empty `steps`, or the
   loader silently skips it. IDs must match `goto`/`entryStep` exactly.
10. **Test:** launch the workflow (UI "Workflows ›" dropdown or `/api/workflows`) and watch
    for `$blocked`/`Max iterations` outcomes; iterate.

---

## 9. Worked Examples

### 9.1 Minimal skeleton — linear chain

```json
{
  "metadata": {
    "id": "hello-check",
    "name": "Hello Check",
    "description": "Greet, run tests, report.",
    "version": "1.0.0",
    "color": "#22c55e"
  },
  "entryStep": "greet",
  "settings": { "maxIterations": 10 },
  "steps": [
    {
      "id": "greet",
      "name": "Greet",
      "type": "agent",
      "phase": "build",
      "agentId": "builder",
      "prompt": "Say hi in one line. Then call step_done().",
      "transitions": [{ "when": { "type": "always" }, "goto": "run_tests" }]
    },
    {
      "id": "run_tests",
      "name": "Run Tests",
      "type": "shell",
      "phase": "verification",
      "command": "npm run test",
      "transitions": [
        { "when": { "type": "step_result", "result": "success" }, "goto": "report" },
        { "when": { "type": "always" }, "goto": "$blocked" }
      ]
    },
    {
      "id": "report",
      "name": "Report",
      "type": "agent",
      "phase": "verification",
      "agentId": "builder",
      "prompt": "Tests passed. Summarize in two lines, then call step_done().",
      "transitions": [{ "when": { "type": "always" }, "goto": "$done" }]
    }
  ],
  "startCondition": { "type": "always" }
}
```

### 9.2 Rich — loop with metadata gating and a human gate

Uses `session_metadata` statuses: builder marks criteria `completed`; verifier flips them
to `passed`/`failed`; the workflow advances only when all are `passed`, with an `always`
fallback that loops back to the builder.

```json
{
  "metadata": {
    "id": "review-loop",
    "name": "Review Loop",
    "description": "Implement, verify, human-approve, finalize.",
    "version": "1.0.0",
    "color": "#a371f7"
  },
  "entryStep": "build",
  "settings": { "maxIterations": 50 },
  "steps": [
    {
      "id": "build",
      "name": "Implement",
      "type": "agent",
      "phase": "build",
      "agentId": "builder",
      "prompt": "Fulfil the {{criteriaCount}} criteria. Update each with session_metadata (status completed). Then call step_done().",
      "transitions": [
        {
          "when": {
            "type": "metadata_all_in",
            "key": "criteria",
            "field": "status",
            "values": ["completed", "passed"]
          },
          "goto": "verify"
        },
        { "when": { "type": "always" }, "goto": "build" }
      ]
    },
    {
      "id": "verify",
      "name": "Verify",
      "type": "sub_agent",
      "phase": "verification",
      "subAgentType": "verifier",
      "prompt": "## Criteria\n{{criteriaList}}\n\nMark each as passed or failed via session_metadata.",
      "transitions": [
        {
          "when": { "type": "metadata_all_match", "key": "criteria", "field": "status", "value": "passed" },
          "goto": "approve"
        },
        { "when": { "type": "always" }, "goto": "build" }
      ]
    },
    {
      "id": "approve",
      "name": "Approve",
      "type": "user",
      "phase": "verification",
      "transitions": [
        { "when": { "type": "step_result", "result": "go" }, "goto": "finalize" },
        { "when": { "type": "step_result", "result": "rework" }, "goto": "build" },
        { "when": { "type": "always" }, "goto": "finalize" }
      ]
    },
    {
      "id": "finalize",
      "name": "Finalize",
      "type": "agent",
      "phase": "verification",
      "agentId": "builder",
      "prompt": "Wrap up with a summary of what changed, then call step_done().",
      "transitions": [{ "when": { "type": "always" }, "goto": "$done" }]
    }
  ],
  "startCondition": { "type": "always" }
}
```

---

## 10. Troubleshooting (authoring mistakes)

| Symptom                                    | Likely cause                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow doesn't appear at all             | File invalid (missing `metadata.id` or empty `steps`) or malformed JSON — loader skips it. Wrong filename (must be `{id}.workflow.json`). |
| Stuck looping on one agent step            | Agent never calls `step_done()`. Add the instruction to the prompt.                                                                       |
| "Runner blocked: No matching transition"   | No condition matched. Add an `always` fallback, or fix `step_result` strings / metadata field names to match exactly.                     |
| Never leaves a step despite `step_result`  | Result string mismatch (case/whitespace) or wrong step's output is being inspected (`stepOutput` is the immediately-preceding step).      |
| Blocked immediately at start               | `startCondition` (non-`always`) evaluated false against current session metadata.                                                         |
| "Max iterations (N) reached"               | Loop lacks a terminating condition. Widen the escape conditions, not just `maxIterations`.                                                |
| User step shows unexpected/missing buttons | Choices are derived only from `step_result` and `always` transitions of that step.                                                        |
