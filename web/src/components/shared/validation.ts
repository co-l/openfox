export function validateProjectName(name: string): { valid: true } | { valid: false; error: string } {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Project name cannot be empty' }
  }

  const validPattern = /^[a-zA-Z0-9._-]+$/
  if (!validPattern.test(name)) {
    return {
      valid: false,
      error: 'Project name can only contain letters, numbers, hyphens, underscores, and dots'
    }
  }

  return { valid: true }
}