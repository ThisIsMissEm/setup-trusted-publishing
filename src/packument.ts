import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface PackageJson {
  name?: string
  version?: string
  private?: boolean
  description?: string
  author?: unknown
  contributors?: unknown
  license?: string
  homepage?: string
  repository?: unknown
  bugs?: unknown
  keywords?: string[]
  packageManager?: string
  publishConfig?: {
    access?: 'public' | 'restricted'
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface ReadPackageResult {
  raw: string
  parsed: PackageJson
  indent: string
  hasTrailingNewline: boolean
}

export async function readPackage(cwd: string): Promise<ReadPackageResult> {
  const filePath = join(cwd, 'package.json')
  const raw = await readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw) as PackageJson

  const indentMatch = raw.match(/\n([ \t]+)"/)
  const indent = indentMatch ? indentMatch[1] : '  '
  const hasTrailingNewline = raw.endsWith('\n')

  return { raw, parsed, indent, hasTrailingNewline }
}

export interface PackageUpdates {
  publishConfig?: Partial<NonNullable<PackageJson['publishConfig']>>
  repository?: string
}

export async function writePackageFields(
  cwd: string,
  result: ReadPackageResult,
  updates: PackageUpdates
): Promise<void> {
  const { parsed, indent, hasTrailingNewline } = result

  const updated: PackageJson = { ...parsed }

  if (updates.publishConfig) {
    updated.publishConfig = { ...parsed.publishConfig, ...updates.publishConfig }
  }

  if (updates.repository !== undefined && !parsed.repository) {
    // Reconstruct to position repository before license (standard package.json field order)
    const ANCHOR_KEYS = new Set([
      'license',
      'files',
      'scripts',
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
      'engines',
      'publishConfig',
    ])
    const reordered: PackageJson = {}
    let placed = false
    for (const [k, v] of Object.entries(updated) as [string, unknown][]) {
      if (!placed && ANCHOR_KEYS.has(k)) {
        reordered['repository'] = updates.repository
        placed = true
      }
      reordered[k] = v
    }
    if (!placed) reordered['repository'] = updates.repository
    Object.keys(updated).forEach((k) => delete updated[k])
    Object.assign(updated, reordered)
  } else if (updates.repository !== undefined) {
    updated.repository = updates.repository
  }

  let content = JSON.stringify(updated, null, indent)
  if (hasTrailingNewline) content += '\n'

  await writeFile(join(cwd, 'package.json'), content, 'utf8')
}
