# Dream — Per-step dynamic orchestration

This describes the four-phase feature that lets you choose, per workflow step,
which LLM orchestrates, which produces code, and which verifies — transparently
once configured, with no cap on the number of steps or models.

| Phase | What it adds                                                                                     | Where                                                      |
| ----- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 0     | Plugin API extension point for custom transition handlers                                        | `src/server/providers/plugins/registry.ts`                 |
| 1     | Per-step model override (`workflowId:stepId`)                                                    | `src/server/agents/model-overrides.ts`                     |
| 2     | Teams: a named bundle of `stepId -> { providerId, model, reasoningEffort? }` bound to a workflow | `src/server/agents/teams.ts`, `src/server/routes/teams.ts` |
| 3     | Built-in `llm_decision` transition handler: an LLM picks the next step                           | `src/server/workflows/llm-decision-handler.ts`             |

## How they compose

Resolution precedence for a step's LLM client (in `resolveLLMClientForStep`):

```
explicit step override  >  team assignment  >  agent override  >  session model
```

When a step's transitions use `when: { type: 'custom', handler: 'llm_decision',
config }`, the executor passes that step's **resolved** client to the handler.
So "which LLM orchestrates this step" is exactly the model you assigned to that
step — per step, via a team, or via an explicit override. One LLM call is made
per `(workflow, step, outcome)` and shared across sibling transitions; only the
transition whose `thisGoto` matches the LLM's choice fires. If the call fails or
the response is unparseable, the handler returns false and a following `always`
fallback wins — routing never blocks.

## Configuring it

### 1. Bind a team to a workflow (recommended for N steps / N models)

```bash
# Create a team that assigns a different model to each step.
curl -X PUT localhost:3000/api/teams/dream-team \
  -H 'content-type: application/json' \
  -d '{
    "name": "Dream team",
    "assignments": {
      "build":  { "providerId": "openai",    "model": "gpt-4o" },
      "verify": { "providerId": "anthropic", "model": "claude-sonnet-5", "reasoningEffort": "high" },
      "review": { "providerId": "openai",    "model": "gpt-4o-mini" }
    }
  }'

# Bind the workflow to the team (every run resolves steps from it).
curl -X PUT localhost:3000/api/teams/bindings/dream \
  -H 'content-type: application/json' \
  -d '{"teamId":"dream-team"}'
```

### 2. Or override a single step

```bash
curl -X PUT localhost:3000/api/workflows/dream/steps/verify/model \
  -H 'content-type: application/json' \
  -d '{ "providerId": "anthropic", "model": "claude-sonnet-5", "reasoningEffort": "high" }'
```

### 3. Use `llm_decision` in the workflow

See `.openfox/workflows/dream.workflow.json` for a full example. The routing
step declares one `custom` transition per candidate, each with the shared
`candidates` list and its own `thisGoto`:

```json
{
  "when": {
    "type": "custom",
    "handler": "llm_decision",
    "config": {
      "prompt": "Given the verification outcome, what should we do next?",
      "candidates": [
        { "goto": "build", "label": "Retry build", "description": "Tests failed" },
        { "goto": "review", "label": "Send to review", "description": "Passed" },
        { "goto": "$done", "label": "Finish", "description": "Nothing left" }
      ],
      "thisGoto": "build"
    }
  },
  "goto": "build"
}
```

Repeat for each candidate's `thisGoto`, then add an `always` fallback. The
handler is registered as a built-in before plugins load; a plugin registering
`llm_decision` overrides it.

## Verification

`src/server/workflows/phase4-integration.test.ts` proves the composition
end-to-end: the `llm_decision` call is made on the step-resolved (team) client,
the session client is not consulted, and routing follows the LLM's choice (or
falls through to the `always` fallback on an unparseable response).
