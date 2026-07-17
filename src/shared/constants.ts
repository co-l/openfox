// Matched via startsWith() — covers text/plain, text/csv, text/html, etc.
export const TEXT_MIME_PREFIXES = ['text/']

// Matched via exact comparison to avoid prefix collisions
export const TEXT_MIME_EXACT = [
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/javascript',
  'application/xhtml+xml',
  'application/x-sh',
  'image/svg+xml',
]
