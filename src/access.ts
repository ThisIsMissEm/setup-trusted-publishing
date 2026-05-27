export type AccessValue = 'public' | 'restricted'
export type ConflictType = 'flag-vs-private' | 'flag-vs-existing'
export type ReasonType = 'cli-flag' | 'existing' | 'inferred-private' | 'inferred-default'

export class AccessConflictError extends Error {
  readonly conflict: ConflictType
  readonly existingAccess?: AccessValue
  readonly flagAccess?: AccessValue

  constructor(
    conflict: ConflictType,
    message: string,
    opts?: { existingAccess?: AccessValue; flagAccess?: AccessValue }
  ) {
    super(message)
    this.name = 'AccessConflictError'
    this.conflict = conflict
    this.existingAccess = opts?.existingAccess
    this.flagAccess = opts?.flagAccess
  }
}

export interface AccessResolution {
  value: AccessValue
  reason: ReasonType
  changed: boolean
  overwrote?: AccessValue
}

export interface ResolveAccessInput {
  isPrivate: boolean | undefined
  existingAccess: AccessValue | undefined
  flagAccess: AccessValue | undefined
  force: boolean
}

export function resolveAccess(input: ResolveAccessInput): AccessResolution {
  const { isPrivate, existingAccess, flagAccess, force } = input

  // Rows 1 & 2: existing publishConfig.access set, flag set, they differ
  if (existingAccess !== undefined && flagAccess !== undefined && flagAccess !== existingAccess) {
    if (!force) {
      throw new AccessConflictError(
        'flag-vs-existing',
        `--access ${flagAccess} conflicts with existing publishConfig.access "${existingAccess}" in package.json.\nTo overwrite the existing value, pass --force.`,
        { existingAccess, flagAccess }
      )
    }
    return { value: flagAccess, reason: 'cli-flag', changed: true, overwrote: existingAccess }
  }

  // Rows 3 & 4: private:true, no existing publishConfig, --access public
  if (isPrivate === true && existingAccess === undefined && flagAccess === 'public') {
    if (!force) {
      throw new AccessConflictError(
        'flag-vs-private',
        '--access public conflicts with "private": true in package.json.\nIf this package is genuinely intended for public release, remove "private": true from package.json.\nTo bypass this check, pass --force.',
        { flagAccess: 'public' }
      )
    }
    return { value: 'public', reason: 'cli-flag', changed: true }
  }

  // Row 6: existing set, flag set, they match
  if (existingAccess !== undefined && flagAccess !== undefined && flagAccess === existingAccess) {
    return { value: existingAccess, reason: 'existing', changed: false }
  }

  // Row 7: existing set, no flag
  if (existingAccess !== undefined && flagAccess === undefined) {
    return { value: existingAccess, reason: 'existing', changed: false }
  }

  // Row 5: no existing, flag set (remaining cases are conflict-free)
  if (existingAccess === undefined && flagAccess !== undefined) {
    return { value: flagAccess, reason: 'cli-flag', changed: true }
  }

  // Row 8: private:true, no existing, no flag
  if (isPrivate === true) {
    return { value: 'restricted', reason: 'inferred-private', changed: true }
  }

  // Row 9: default
  return { value: 'public', reason: 'inferred-default', changed: true }
}
