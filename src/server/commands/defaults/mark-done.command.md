---
id: mark-done
name: Mark Task as Done
---

Mark the task you are currently working on as done using the `project_tasks` tool.

1. Use `project_tasks` with `action=list, status='in_progress'` to find the task bound to your current session (the one in the In Progress column).
2. If no task is bound to your session, check `action=list, status='done'` for it: if it is already there, report that instead of re-moving it.
3. Confirm the work is genuinely complete before proceeding.
4. Move it: `action=move`, `taskId=<id>`, `to='done'`.
5. If the move is blocked by unmet column gates, the error lists the missing fields: fill each with `action=set_gate_value` (`taskId`, `gateId`, `value` — provide real proof/evidence as part of your work), then retry the move.
6. If you get a CONFLICT, someone else changed the task: re-list (`action=list, status='in_progress'`) and retry.
7. Confirm the final state to the user.
