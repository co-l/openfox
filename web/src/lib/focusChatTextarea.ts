export const CHAT_TEXTAREA_ID = 'openfox-chat-textarea'

export function focusChatTextarea(): void {
  const textarea = document.getElementById(CHAT_TEXTAREA_ID) as HTMLTextAreaElement | null
  if (textarea) {
    textarea.focus()
  }
}
