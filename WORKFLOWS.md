# OpenFox Workflows Guide

Workflows define how OpenFox orchestrates tasks across multiple steps, agents, and sub-agents. They enable complex automation patterns like build → test → fix loops, multi-agent collaboration, and conditional execution based on step results.

## Quick Start

### Accessing Workflows

1. **From the chat**: Click the **"Workflows ›"** button above the send input
2. **Select a workflow**: Choose from the dropdown (e.g., "Build & Verify", "Test")
3. **Edit a workflow**: Click the edit (pencil) icon next to any workflow
4. **Manage all workflows**: Click "Manage Workflows..." at the bottom of the dropdown

### Creating a New Workflow

1. Click **"Workflows ›"** → **"Manage Workflows..."** → **"+ New"**
2. Fill in the basics:
   - **Name**: Human-readable name (e.g., "Build → Test → Fix")
   - **ID**: Auto-generated slug (e.g., `build-test-fix`)
   - **Description**: What this workflow does
   - **Max Iterations**: Safety limit (default: 50)
   - **Color**: Visual identifier in the UI
3. Add steps using **"+ Add Step"**
4. Configure transitions by clicking the edges between steps
5. Click **"Save & Close"**

---

## Workflow Editor

The workflow editor shows a visual flow diagram with:

- **Start** node (green) - Entry point
- **Step nodes** (blue/purple/green) - Agent, Sub-Agent, or Shell steps
- **Done** node (gray) - Workflow completion
- **Edges** - Transitions with conditions

### Step Types

| Type | Use Case | Options |
|------|----------|---------|
| **Agent** | Main task execution | Builder, Planner, Tester |
| **Sub-Agent** | Specialized tasks | `code_reviewer`, `debugger`, `test_generator`, `verifier` |
| **Shell** | Run commands | (none) |

### Transition Conditions

Click an edge to configure when the workflow moves to the next step:

| Condition | Description |
|-----------|-------------|
| **All criteria passed** | Every criterion has `passed` status |
| **All criteria completed or passed** | Criteria are either `completed` or `passed` |
| **Any criteria blocked** | A criterion failed 4+ times (retry limit) |
| **Has pending or failed criteria** | At least one criterion is not `passed` |
| **Step result is...** | The previous step returned a specific result |
| **Always (fallback)** | Unconditional transition (use as final fallback) |

---

## Step Results Feature

Step results allow fine-grained control over workflow branching based on what a step returns.

### How It Works

1. A step (agent/sub-agent/shell) returns a result:
   - **Agents**: Use `return_value` tool with `content` and optional `result`
   - **Sub-agents**: Use `return_value` tool (automatically available)
   - **Shell**: Exit code determines result (`success` for 0, `failure` otherwise)
2. The next transition checks if the result matches the expected value
3. Different results can route to different follow-up steps

### Example: Build → Test → Fix Loop

```
Start → Build → Test → (if passed) → Done
                     → (if failed) → Fix → Test...
```

**Configuration:**

1. **Build step** (Agent: Builder)
   - Prompt: `Build the project and return "success" or "failed"`
   
2. **Test step** (Agent: Tester)  
   - Prompt: `Run tests and report results`
   
3. **Transition: Test → Done**
   - Condition: `Step result is...` → `passed`
   
4. **Transition: Test → Fix**
   - Condition: `Step result is...` → `failed`
   
5. **Fix step** (Sub-Agent: debugger)
   - Prompt: `Analyze test failures and fix the code`
   - Transition back to Test with: `Always`

---

## Tutorial: Multi-Agent Code Review Workflow

This tutorial creates a workflow that coordinates multiple agents:

```
Start → Implement → Code Review → (if approved) → Generate Tests → Done
                                      → (if changes needed) → Implement...
```

### Step 1: Create the Workflow

1. Click **"Workflows ›"** → **"Manage Workflows..."** → **"+ New"**
2. Fill in:
   - Name: `Review Loop`
   - Description: `Implement with code review and auto-generated tests`
   - Max Iterations: `50`

### Step 2: Add the Implement Step

1. Click **"+ Add Step"** (adds a Builder step after Start)
2. Configure:
   - **Type**: Agent
   - **Agent Type**: Builder
   - **Prompt**: 
     ```
     Implement the requested feature. Focus on clean, working code.
     When done, use return_value with result "ready-for-review"
     ```
   - **Nudge Prompt** (for retries):
     ```
     Continue implementing. {{verifierFindings}}
     ```

### Step 3: Add the Code Review Step

1. Click **"+ Add Step"** again (adds second Builder)
2. Click the second step node to configure:
   - **Type**: Sub-Agent
   - **Agent Type**: code_reviewer
   - **Prompt**:
     ```
     Review the implemented code for:
     - Bugs and edge cases
     - Code style and conventions  
     - Performance issues
     
     Use return_value with:
     - result "approved" if code is good
     - result "changes-needed" with specific feedback
     ```

### Step 4: Add the Generate Tests Step

1. Click **"+ Add Step"** (adds third step)
2. Configure:
   - **Type**: Sub-Agent
   - **Agent Type**: test_generator
   - **Prompt**:
     ```
     Generate comprehensive tests for the implemented feature.
     Use return_value with result "tests-ready" when done.
     ```

### Step 5: Configure Transitions

**Implement → Code Review:**
- Click the edge between them
- Condition: `Always`

**Code Review → Generate Tests:**
- Click the edge
- Condition: `Step result is...` → `approved`

**Code Review → Implement (loop back):**
- Drag from Code Review's bottom port to Implement's top port
- Click the new edge
- Condition: `Step result is...` → `changes-needed`

**Generate Tests → Done:**
- Click the edge
- Condition: `Always`

### Step 6: Save and Use

1. Click **"Save & Close"**
2. In chat, click **"Workflows ›"** and select "Review Loop"
3. Describe your feature request
4. Watch the agents collaborate!

---

## Template Variables

Use these in prompts to inject dynamic context:

| Variable | Description |
|----------|-------------|
| `{{workdir}}` | Project working directory |
| `{{reason}}` | Why the step is being (re)entered |
| `{{stepOutput}}` | Output from the previous step |
| `{{stepOutput.stepId}}` | Output from a specific step |
| `{{criteriaCount}}` | Total number of criteria |
| `{{pendingCount}}` | Criteria still pending |
| `{{summary}}` | Session summary |
| `{{criteriaList}}` | Formatted list of all criteria |
| `{{modifiedFiles}}` | Files changed in this session |
| `{{verifierFindings}}` | (Deprecated) Use `{{stepOutput.verifier}}` |
| `{{previousStepOutput}}` | (Deprecated) Use `{{stepOutput}}` |

### Using Step Results in Templates

```yaml
# In a Fix step prompt:
The previous review found issues: {{stepOutput.code_reviewer}}
Address these specific concerns and return "ready-for-review" when done.
```

---

## Best Practices

### 1. Always Include a Fallback
End workflow branches with an "Always" transition to prevent dead ends.

### 2. Use Descriptive Result Values
Instead of generic "success"/"failed", use specific values:
- `tests-passed`, `tests-failed`
- `review-approved`, `changes-needed`
- `build-success`, `build-error`

### 3. Limit Retry Loops
Set reasonable max iterations and use "Any criteria blocked" conditions to escape infinite loops.

### 4. Document Your Workflows
Add clear descriptions so teammates understand the workflow's purpose.

### 5. Test Incrementally
Create simple workflows first, then add complexity as you validate each piece.

---

## Troubleshooting

### "Runner blocked: No matching transition"
The current step completed but no transition condition matched. Fix by:
- Adding an "Always" fallback transition
- Checking that step result values match your conditions exactly

### Step not executing
- Verify the entry condition is met (green dot shows "Entry condition met")
- Check that the previous step's transition leads to this step

### Workflow not appearing in dropdown
- Save the workflow first
- Refresh the dropdown by closing and reopening it

---

## Reference

### Built-in Workflows

| Workflow | Purpose |
|----------|---------|
| `Build & Verify` | Standard loop: Builder implements, Verifier checks |
| `Test` | Run tests and report results |

### Sub-Agent Types

| ID | Purpose |
|----|---------|
| `code_reviewer` | Review code quality |
| `debugger` | Analyze and fix errors |
| `test_generator` | Create test files |
| `verifier` | Check acceptance criteria |

### Result Return Format

In agent prompts, instruct the agent to return results:

```
When you finish, use the return_value tool:
  - result: "approved"
  - output: "Code looks good, no issues found"
```

This makes the result available for transition conditions and `{{stepOutput}}` templates.
