import { useCallback } from 'react'
import { useSessionStore } from '../stores/session'
import { resolveWorkflowForLaunch } from '../lib/workflow-scope'
import { readAgents, readAllWorkflows, workflowResource } from '../lib/resources'
import { parseModelValue } from '../lib/model-value'
import { shouldGateEffortChange, resolveWorkflowFirstAgentId } from '../lib/effort-gate'
import { useEffortGateContext } from './useEffortGateContext'
import type { Attachment, WorkflowLaunchScope } from '@shared/types.js'

function sessionWorkdir(sessionId: string | null | undefined): string | undefined {
  const state = useSessionStore.getState()
  if (!sessionId) return state.currentSession?.workdir
  return (
    state.panes?.[sessionId]?.session?.workdir ??
    (state.currentSession?.id === sessionId ? state.currentSession?.workdir : undefined)
  )
}

export function useScrolledSend(setAutoScroll: (active: boolean) => void, sessionId: string | null | undefined) {
  const storeSendMessage = useSessionStore((state) => state.sendMessage)
  const storeLaunchWorkflow = useSessionStore((state) => state.launchWorkflow)
  const pinSessionEffort = useSessionStore((state) => state.pinSessionEffort)
  const clearSessionEffortPin = useSessionStore((state) => state.clearSessionEffortPin)
  const { currentEffort, warmCache, gate } = useEffortGateContext(sessionId)

  const sendMessage = useCallback(
    (content: string, attachments?: Attachment[], opts?: { messageKind?: 'command'; isSystemGenerated?: boolean }) => {
      setAutoScroll(true)
      if (!sessionId) return
      storeSendMessage(sessionId, content, attachments, opts)
    },
    [setAutoScroll, storeSendMessage, sessionId],
  )

  const launchWorkflow = useCallback(
    async (
      content?: string,
      attachments?: Attachment[],
      workflowId?: string,
      subGroup?: string,
      params?: Record<string, string>,
      scope: WorkflowLaunchScope = 'auto',
    ) => {
      setAutoScroll(true)
      if (!sessionId) return

      // A workflow whose first agent step carries an effort override may
      // invalidate the LLM prefix cache on a warm session. Gate it behind an
      // explicit choice before launching: Apply clears any pin (the override
      // effort takes effect), Keep pins the current effort.
      //
      // Only the ENTRY transition is gated — a workflow may still switch to an
      // override agent mid-run, which invalidates the cache without a prompt.
      if (workflowId && warmCache) {
        // Cheap pre-check: if no agent override carries an effort at all, no
        // gate can ever trigger — skip the workflow fetch roundtrip entirely.
        const modelOverrides = readAgents(sessionWorkdir(sessionId))?.modelOverrides ?? {}
        const anyOverrideEffort = Object.values(modelOverrides).some((v) => parseModelValue(v)?.reasoningEffort)
        if (anyOverrideEffort) {
          const workflows = readAllWorkflows(sessionWorkdir(sessionId))
          const wf = resolveWorkflowForLaunch(workflows, workflowId, scope)
          if (wf) {
            const full = await workflowResource.refresh(wf.id, sessionWorkdir(sessionId), wf.scope)
            const agentId = full ? resolveWorkflowFirstAgentId(full, subGroup) : undefined
            const overrideEffort = agentId ? parseModelValue(modelOverrides[agentId])?.reasoningEffort : undefined
            if (
              overrideEffort &&
              shouldGateEffortChange({
                warmCache,
                currentEffort,
                proposedEffort: overrideEffort,
              })
            ) {
              const choice = await gate.requestEffortSwitch({
                fromEffort: currentEffort,
                toEffort: overrideEffort,
                contextLabel: wf.name,
              })
              if (choice === 'keep') {
                if (currentEffort) await pinSessionEffort(sessionId, currentEffort)
              } else {
                await clearSessionEffortPin(sessionId)
              }
            }
          }
        }
      }

      storeLaunchWorkflow(sessionId, content, attachments, workflowId, subGroup, params, scope)
    },
    [
      setAutoScroll,
      storeLaunchWorkflow,
      sessionId,
      warmCache,
      currentEffort,
      gate,
      pinSessionEffort,
      clearSessionEffortPin,
    ],
  )

  return { sendMessage, launchWorkflow }
}
