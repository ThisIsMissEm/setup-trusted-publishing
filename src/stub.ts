import { writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { PackageJson } from './packument.ts'

const OPTIONAL_FIELDS = [
  'author',
  'contributors',
  'license',
  'homepage',
  'repository',
  'bugs',
  'keywords',
] as const

const EXPECTED_FILES = ['README.md', 'index.js', 'package.json']

export interface StubManifest {
  name: string
  version: '0.0.0'
  main: 'index.js'
  description: string
  publishConfig: { access: 'public' | 'restricted'; [key: string]: unknown }
  [key: string]: unknown
}

export function buildStubManifest(
  source: PackageJson,
  resolvedAccess: 'public' | 'restricted'
): StubManifest {
  if (!source.name) {
    throw new Error('package.json is missing the required "name" field')
  }

  // provenance is a publish-time flag that errors with tarball publishing — strip it from the stub
  const { provenance, ...publishConfigBase } = { ...source.publishConfig }

  const manifest: StubManifest = {
    name: source.name,
    version: '0.0.0',
    main: 'index.js',
    description: source.description ?? 'Stub package for npm trusted publishing setup',
    publishConfig: { ...publishConfigBase, access: resolvedAccess },
  }

  for (const field of OPTIONAL_FIELDS) {
    const value = source[field]
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    manifest[field] = value
  }

  return manifest
}

export async function writeStubDir(dir: string, manifest: StubManifest): Promise<void> {
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  await writeFile(join(dir, 'index.js'), 'module.exports = {};\n', 'utf8')
  await writeFile(
    join(dir, 'README.md'),
    `# ${manifest.name}\n\nThis is a stub package published by setup-trusted-publishing to enable OIDC trusted publishing configuration.\n`,
    'utf8'
  )
}

export async function verifyStubDir(dir: string): Promise<void> {
  const files = await readdir(dir)
  const actual = files.sort()
  const expected = [...EXPECTED_FILES].sort()

  if (actual.join(',') !== expected.join(',')) {
    const unexpected = actual.filter((f) => !expected.includes(f))
    const missing = expected.filter((f) => !actual.includes(f))
    const parts: string[] = []
    if (unexpected.length) parts.push(`unexpected: ${unexpected.join(', ')}`)
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`)
    throw new Error(`Stub directory contents mismatch — ${parts.join('; ')}`)
  }
}
