/**
 * UUID generation utility with fallback for browsers that don't support crypto.randomUUID()
 */

/**
 * Generate a random UUID
 * Uses crypto.randomUUID() if available, otherwise falls back to a polyfill
 */
export function generateUUID(): string {
  // Try native implementation first
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID()
    } catch {
      // Fall through to polyfill
    }
  }
  
  // Polyfill for browsers without crypto.randomUUID()
  // Based on RFC 4122 version 4 UUID specification
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
