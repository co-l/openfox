# OpenFox Workflows — Spec Pointer

The canonical specification for authoring OpenFox workflow files (`.workflow.json`)
lives in the built-in **`workflows` skill** at
`src/server/skills/defaults/workflows/SKILL.md`. Agents authoring or editing workflows
load it via `load_skill("workflows")` to get the full reference — step types
(`agent`/`sub_agent`/`shell`/`user`/`parallel`), transitions & conditions, runtime
semantics, template variables, sub-groups, the authoring checklist, worked examples,
and troubleshooting.

Workflow files are plain JSON, one per file named `{id}.workflow.json`, stored in
project `.openfox/workflows/` (committed; recommended for agent-authored workflows) or
user-global `{configDir}/workflows/`, overriding bundled defaults in
`src/server/workflows/defaults/`. Executor implementation: `src/server/workflows/`
(`types.ts`, `executor.ts`, `registry.ts`, `parallel.ts`, `template.ts`) and
`src/server/routes/workflows.ts`.
