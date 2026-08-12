import { useCallback } from 'react'
import { useSessionStore } from '../stores/session'
import type { Attachment, WorkflowLaunchScope } from '@shared/types.js'

export function useScrolledSend(setAutoScroll: (active: boolean) => void, sessionId: string | null | undefined) {
  const storeSendMessage = useSessionStore((state) => state.sendMessage)
  const storeLaunchWorkflow = useSessionStore((state) => state.launchWorkflow)

  const sendMessage = useCallback(
    (content: string, attachments?: Attachment[], opts?: { messageKind?: 'command'; isSystemGenerated?: boolean }) => {
      setAutoScroll(true)
      if (!sessionId) return
      storeSendMessage(sessionId, content, attachments, opts)
    },
    [setAutoScroll, storeSendMessage, sessionId],
  )

  const launchWorkflow = useCallback(
    (
      content?: string,
      attachments?: Attachment[],
      workflowId?: string,
      subGroup?: string,
      params?: Record<string, string>,
      scope: WorkflowLaunchScope = 'auto',
    ) => {
      setAutoScroll(true)
      if (!sessionId) return
      storeLaunchWorkflow(sessionId, content, attachments, workflowId, subGroup, params, scope)
    },
    [setAutoScroll, storeLaunchWorkflow, sessionId],
  )

  return { sendMessage, launchWorkflow }
}
