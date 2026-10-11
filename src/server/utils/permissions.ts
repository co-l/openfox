import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'

function sanitizeShellArg(arg: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(arg)) {
    throw new Error(`Invalid argument: ${arg}`)
  }
  return arg
}

function runSync(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf-8', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `Command failed: ${command} ${args.join(' ')}`)
  }
  return result.stdout
}

function runSyncOptional(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { encoding: 'utf-8', windowsHide: true })
  if (result.error || result.status !== 0) return null
  return result.stdout
}

function addUserToGroup(groupName: string): void {
  const currentUser = runSync('id', ['-un']).trim()
  runSync('sudo', ['usermod', '-aG', sanitizeShellArg(groupName), sanitizeShellArg(currentUser)])
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
  const sudoAvailable = runSyncOptional('sudo', ['-n', 'true']) !== null

  // Get the directory's group and permissions
  const dirStat = await stat(resolvedPath)
  const groupGid = dirStat.gid

  // Get current user's groups
  const currentUser = sanitizeShellArg(runSync('id', ['-un']).trim())
  const groupsOutput = runSync('id', ['-Gn', currentUser]).trim()
  const userGroups = groupsOutput.split(/\s+/)

  // Get the group name for the directory's gid
  let groupName: string | null = null
  const rawGroupName = runSyncOptional('getent', ['group', String(groupGid)])
  if (rawGroupName) {
    const name = rawGroupName.split(':')[0]?.trim()
    if (name) {
      try {
        groupName = sanitizeShellArg(name)
      } catch {
        // ignore invalid group names
      }
    }
  }

  // Check if user is in the directory's group
  const userInGroup = groupName ? userGroups.includes(groupName) : false

  // Check group write permission (mode & 020)
  const groupHasWrite = (dirStat.mode & 0o020) !== 0

  return { resolvedPath, groupGid, groupName, userGroups, userInGroup, groupHasWrite, sudoAvailable }
}

export async function checkPermissions(targetPath: string) {
  if (process.platform === 'win32') {
    // Unix group/sudo-based permission management does not apply on Windows
    return { success: false, error: 'Automatic permission management is not supported on Windows', status: 501 }
  }
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
  if (process.platform === 'win32') {
    return {
      success: false,
      sudoAvailable: false,
      error: 'Automatic permission fixes are not supported on Windows',
      status: 501,
    }
  }
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
      runSync('sudo', ['chmod', 'g+w', info.resolvedPath])
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
      runSync('sudo', ['chmod', 'g+w', info.resolvedPath])
      addUserToGroup(info.groupName)
      return { success: true, sudoAvailable: info.sudoAvailable, method: 'join_group_and_group' }
    }

    // ownership action
    const ownerUser = runSync('id', ['-un']).trim()
    runSync('sudo', ['chown', '-R', sanitizeShellArg(ownerUser), info.resolvedPath])
    return { success: true, sudoAvailable: info.sudoAvailable, method: 'ownership' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message === 'Path not found') {
      return { success: false, sudoAvailable: true, error: message, status: 404 }
    }
    return { success: false, sudoAvailable: true, error: message }
  }
}
