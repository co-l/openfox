export const CHAT_TEXTAREA_ID = 'openfox-chat-textarea'

export function focusChatTextarea(preventScroll?: boolean): void {
  const textarea = document.getElementById(CHAT_TEXTAREA_ID) as HTMLTextAreaElement | null
  if (textarea) {
    if (preventScroll === undefined) {
      textarea.focus()
    } else {
      textarea.focus({ preventScroll })
    }
  }
}
