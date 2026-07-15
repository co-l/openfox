import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'

function sanitizeShellArg(arg: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(arg)) {
    throw new Error(`Invalid argument: ${arg}`)
  }
  return arg
}

function addUserToGroup(groupName: string): void {
  const currentUser = execSync('id -un', { encoding: 'utf-8', windowsHide: true }).trim()
  execSync(`sudo usermod -aG ${sanitizeShellArg(groupName)} ${sanitizeShellArg(currentUser)}`, {
    stdio: 'pipe',
    windowsHide: true,
  })
}

interface DirInfo {
  resolvedPath: string
  groupGid: number
  groupName: string | null
  userGroups: string[]
  userInGroup: boolean
  groupHasWrite: boolean
  sudoAvailable: boolean
}

async function getDirInfo(targetPath: string): Promise<DirInfo> {
  const resolvedPath = resolve(targetPath)

  // Check if the path exists
  try {
    await access(resolvedPath, constants.F_OK)
  } catch {
    throw new Error('Path not found')
  }

  // Check if passwordless sudo is available
  let sudoAvailable: boolean
  try {
    execSync('sudo -n true', { stdio: 'pipe', windowsHide: true })
    sudoAvailable = true
  } catch {
    sudoAvailable = false
  }

  // Get the directory's group and permissions
  const dirStat = await stat(resolvedPath)
  const groupGid = dirStat.gid

  // Get current user's groups
  const currentUser = sanitizeShellArg(execSync('id -un', { encoding: 'utf-8', windowsHide: true }).trim())
  const groupsOutput = execSync(`id -Gn ${currentUser}`, { encoding: 'utf-8', windowsHide: true }).trim()
  const userGroups = groupsOutput.split(/\s+/)

  // Get the group name for the directory's gid
  let groupName: string | null = null
  try {
    const rawGroupName = execSync(`getent group ${groupGid}`, { encoding: 'utf-8', windowsHide: true })
      .split(':')[0]
      ?.trim()
    groupName = rawGroupName ? sanitizeShellArg(rawGroupName) : null
  } catch {
    // ignore
  }

  // Check if user is in the directory's group
  const userInGroup = groupName ? userGroups.includes(groupName) : false

  // Check group write permission (mode & 020)
  const groupHasWrite = (dirStat.mode & 0o020) !== 0

  return { resolvedPath, groupGid, groupName, userGroups, userInGroup, groupHasWrite, sudoAvailable }
}

export async function checkPermissions(targetPath: string) {
  try {
    const info = await getDirInfo(targetPath)
    return {
      success: true,
      sudoAvailable: info.sudoAvailable,
      userInGroup: info.userInGroup,
      groupHasWrite: info.groupHasWrite,
      groupName: info.groupName,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message === 'Path not found') {
      return { success: false, error: message, status: 404 }
    }
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error', status: 500 }
  }
}

export async function fixPermissions(targetPath: string, action: string) {
  try {
    const info = await getDirInfo(targetPath)

    if (action === 'group') {
      if (!info.userInGroup) {
        return {
          success: false,
          sudoAvailable: info.sudoAvailable,
          error:
            'You are not in the group that owns this directory. Use "Join group & extend group permissions" instead.',
        }
      }
      execSync(`sudo chmod g+w "${info.resolvedPath}"`, { stdio: 'pipe', windowsHide: true })
      return { success: true, sudoAvailable: info.sudoAvailable, method: 'group' }
    }

    if (action === 'join_group') {
      if (!info.groupName) {
        return { success: false, sudoAvailable: info.sudoAvailable, error: 'Could not determine group name' }
      }
      addUserToGroup(info.groupName)
      return { success: true, sudoAvailable: info.sudoAvailable, method: 'join_group' }
    }

    if (action === 'join_group_and_group') {
      if (!info.groupName) {
        return { success: false, sudoAvailable: info.sudoAvailable, error: 'Could not determine group name' }
      }
      execSync(`sudo chmod g+w "${info.resolvedPath}"`, { stdio: 'pipe', windowsHide: true })
      addUserToGroup(info.groupName)
      return { success: true, sudoAvailable: info.sudoAvailable, method: 'join_group_and_group' }
    }

    // ownership action
    const ownerUser = execSync('id -un', { encoding: 'utf-8', windowsHide: true }).trim()
    execSync(`sudo chown -R ${sanitizeShellArg(ownerUser)} "${info.resolvedPath}"`, {
      stdio: 'pipe',
      windowsHide: true,
    })
    return { success: true, sudoAvailable: info.sudoAvailable, method: 'ownership' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message === 'Path not found') {
      return { success: false, sudoAvailable: true, error: message, status: 404 }
    }
    return { success: false, sudoAvailable: true, error: message }
  }
}
