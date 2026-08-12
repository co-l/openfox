/**
 * Changelog helpers: parse version headings and trim the changelog to only the
 * sections newer than a given version, so an updated user sees what changed
 * since the version they were previously running.
 */

const VERSION_HEADING_RE = /^##\s+\[?(\d+\.\d+\.\d+)\]?(?:\s+-.*)?$/

interface Section {
  heading: string
  body: string[]
}

function parseVersion(version: string): number[] | null {
  const parts = version.split('.')
  if (parts.length !== 3) return null
  const nums = parts.map((part) => Number(part))
  if (nums.some((num) => !Number.isInteger(num))) return null
  return nums
}

function isValidVersion(version: string): boolean {
  return parseVersion(version) !== null
}

function gtVersion(a: string, b: string): boolean {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return false
  for (let i = 0; i < 3; i++) {
    const x = pa[i]!
    const y = pb[i]!
    if (x !== y) return x > y
  }
  return false
}

export function parseVersionHeading(line: string): string | null {
  const match = VERSION_HEADING_RE.exec(line.trimEnd())
  return match ? (match[1] ?? null) : null
}

export function trimChangelog(content: string, since?: string): string {
  if (!since || !isValidVersion(since)) return content

  const lines = content.split('\n')

  let i = 0
  const header: string[] = []
  for (; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('## ')) break
    header.push(line)
  }

  const sections: Section[] = []
  let current: Section | null = null
  for (; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('## ')) {
      current = { heading: line, body: [] }
      sections.push(current)
    } else if (current) {
      current.body.push(line)
    }
  }

  const kept = sections.filter((section) => {
    const version = parseVersionHeading(section.heading)
    // Unparseable headings (prereleases, "Unreleased", v-prefixed…) are kept
    // rather than silently dropped, so no future changelog content vanishes.
    return version === null || gtVersion(version, since)
  })

  if (kept.length === 0) return header.join('\n').trimEnd()

  const parts = [header.join('\n'), ...kept.map((section) => [section.heading, ...section.body].join('\n'))]
  return parts
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}
