/**
 * Edit Context Extraction
 * 
 * Computes context lines (4 before, 4 after) for edit_file operations.
 * Handles multiple replacements by merging overlapping context regions.
 */

const CONTEXT_LINES = 4

export interface ContextLine {
  lineNumber: number  // 1-indexed
  content: string
}

export interface SingleEdit {
  startLine: number   // 1-indexed line where old content starts
  endLine: number     // 1-indexed line where old content ends (inclusive)
  oldContent: string
  newContent: string
}

/** 
 * A region represents a contiguous section of the file with context.
 * For single edits, there's one edit in the region.
 * For replace_all with overlapping contexts, multiple edits are merged.
 */
export interface EditRegion {
  beforeContext: ContextLine[]
  afterContext: ContextLine[]
  // For single edit (backwards compat)
  startLine: number
  endLine: number
  oldContent: string
  newContent: string
  // For merged multiple edits
  edits: SingleEdit[]
}

export interface EditContextResult {
  regions: EditRegion[]
}

/**
 * Find all occurrences of a substring in content.
 * Returns array of { index, line } for each match.
 */
function findAllMatches(content: string, searchString: string): Array<{ index: number; line: number }> {
  const matches: Array<{ index: number; line: number }> = []
  let pos = 0
  
  while (true) {
    const index = content.indexOf(searchString, pos)
    if (index === -1) break
    
    // Count lines up to this position
    const beforeMatch = content.slice(0, index)
    const line = beforeMatch.split('\n').length
    
    matches.push({ index, line })
    pos = index + 1 // Move past this match to find next
  }
  
  return matches
}

/**
 * Get the line number where a character index falls.
 * Returns 1-indexed line number.
 */
function getLineNumber(content: string, charIndex: number): number {
  return content.slice(0, charIndex).split('\n').length
}

/**
 * Get the end line number for a multi-line string starting at a given line.
 */
function getEndLine(startLine: number, str: string): number {
  const lineCount = str.split('\n').length
  return startLine + lineCount - 1
}

/**
 * Extract context lines around edit positions.
 * 
 * @param content - Original file content
 * @param oldString - String being replaced
 * @param newString - Replacement string
 * @param replaceAll - If true, find all occurrences
 * @returns EditContextResult with regions containing context and edit info
 */
export function extractEditContext(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean = false
): EditContextResult {
  if (!content || !oldString) {
    return { regions: [] }
  }
  
  // Find all matches
  const matches = findAllMatches(content, oldString)
  
  if (matches.length === 0) {
    return { regions: [] }
  }
  
  // If not replaceAll, only use first match
  const relevantMatches = replaceAll ? matches : [matches[0]!]
  
  // Split content into lines for context extraction
  const lines = content.split('\n')
  
  // Create initial edit regions for each match
  const edits: SingleEdit[] = relevantMatches.map(match => ({
    startLine: match.line,
    endLine: getEndLine(match.line, oldString),
    oldContent: oldString,
    newContent: newString,
  }))
  
  // Merge overlapping regions
  const regions = mergeEditRegions(edits, lines)
  
  return { regions }
}

/**
 * Merge edits into regions, combining those whose contexts overlap.
 */
function mergeEditRegions(edits: SingleEdit[], lines: string[]): EditRegion[] {
  if (edits.length === 0) return []
  
  const totalLines = lines.length
  const regions: EditRegion[] = []
  
  // Sort edits by start line
  const sortedEdits = [...edits].sort((a, b) => a.startLine - b.startLine)
  
  let currentRegion: {
    edits: SingleEdit[]
    contextStart: number  // First line of context (1-indexed)
    contextEnd: number    // Last line of context (1-indexed)
  } | null = null
  
  for (const edit of sortedEdits) {
    const editContextStart = Math.max(1, edit.startLine - CONTEXT_LINES)
    const editContextEnd = Math.min(totalLines, edit.endLine + CONTEXT_LINES)
    
    if (currentRegion === null) {
      // Start new region
      currentRegion = {
        edits: [edit],
        contextStart: editContextStart,
        contextEnd: editContextEnd,
      }
    } else if (editContextStart <= currentRegion.contextEnd + 1) {
      // Overlaps with current region - merge
      currentRegion.edits.push(edit)
      currentRegion.contextEnd = Math.max(currentRegion.contextEnd, editContextEnd)
    } else {
      // No overlap - finalize current region and start new one
      regions.push(buildRegion(currentRegion.edits, currentRegion.contextStart, currentRegion.contextEnd, lines))
      currentRegion = {
        edits: [edit],
        contextStart: editContextStart,
        contextEnd: editContextEnd,
      }
    }
  }
  
  // Finalize last region
  if (currentRegion) {
    regions.push(buildRegion(currentRegion.edits, currentRegion.contextStart, currentRegion.contextEnd, lines))
  }
  
  return regions
}

/**
 * Build an EditRegion from a set of edits and their combined context bounds.
 */
function buildRegion(
  edits: SingleEdit[],
  contextStart: number,
  contextEnd: number,
  lines: string[]
): EditRegion {
  const firstEdit = edits[0]!
  const lastEdit = edits[edits.length - 1]!
  
  // Before context: lines from contextStart up to (but not including) first edit
  const beforeContext: ContextLine[] = []
  for (let i = contextStart; i < firstEdit.startLine; i++) {
    beforeContext.push({
      lineNumber: i,
      content: lines[i - 1] ?? '',  // lines array is 0-indexed
    })
  }
  
  // After context: lines after last edit up to contextEnd
  const afterContext: ContextLine[] = []
  for (let i = lastEdit.endLine + 1; i <= contextEnd; i++) {
    afterContext.push({
      lineNumber: i,
      content: lines[i - 1] ?? '',  // lines array is 0-indexed
    })
  }
  
  return {
    beforeContext,
    afterContext,
    // Primary edit info (first edit for backwards compat)
    startLine: firstEdit.startLine,
    endLine: lastEdit.endLine,
    oldContent: firstEdit.oldContent,
    newContent: firstEdit.newContent,
    // All edits in this region
    edits,
  }
}
