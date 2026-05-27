import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildStubManifest, writeStubDir, verifyStubDir } from '../src/stub.ts'
import type { PackageJson } from '../src/packument.ts'

describe('buildStubManifest', () => {
  test('forces version to 0.0.0 and main to index.js', () => {
    const source: PackageJson = { name: 'my-pkg', version: '1.2.3' }
    const m = buildStubManifest(source, 'public')
    assert.strictEqual(m.version, '0.0.0')
    assert.strictEqual(m.main, 'index.js')
  })

  test('copies name from source', () => {
    const source: PackageJson = { name: 'my-pkg' }
    const m = buildStubManifest(source, 'public')
    assert.strictEqual(m.name, 'my-pkg')
  })

  test('throws if name is missing', () => {
    assert.throws(() => buildStubManifest({}, 'public'), /missing.*"name"/i)
  })

  test('uses placeholder description when absent', () => {
    const source: PackageJson = { name: 'my-pkg' }
    const m = buildStubManifest(source, 'public')
    assert.ok(m.description.length > 0)
  })

  test('copies description if present', () => {
    const source: PackageJson = { name: 'my-pkg', description: 'My cool package' }
    const m = buildStubManifest(source, 'public')
    assert.strictEqual(m.description, 'My cool package')
  })

  test('sets publishConfig.access to resolved value', () => {
    const source: PackageJson = { name: 'my-pkg' }
    const m = buildStubManifest(source, 'restricted')
    assert.strictEqual(m.publishConfig?.access, 'restricted')
  })

  test('drops dependencies, scripts, bin, exports, type, engines', () => {
    const source: PackageJson = {
      name: 'my-pkg',
      dependencies: { lodash: '^4' },
      scripts: { build: 'tsc' },
      bin: { cli: 'dist/cli.js' },
      exports: { '.': './dist/index.js' },
      type: 'module',
      engines: { node: '>=18' },
    }
    const m = buildStubManifest(source, 'public') as Record<string, unknown>
    assert.ok(!('dependencies' in m))
    assert.ok(!('scripts' in m))
    assert.ok(!('bin' in m))
    assert.ok(!('exports' in m))
    assert.ok(!('type' in m))
    assert.ok(!('engines' in m))
  })

  test('copies author, license, keywords if present', () => {
    const source: PackageJson = {
      name: 'my-pkg',
      author: 'Alice',
      license: 'MIT',
      keywords: ['cli', 'npm'],
    }
    const m = buildStubManifest(source, 'public') as Record<string, unknown>
    assert.strictEqual(m['author'], 'Alice')
    assert.strictEqual(m['license'], 'MIT')
    assert.deepStrictEqual(m['keywords'], ['cli', 'npm'])
  })

  test('does not copy empty keywords array', () => {
    const source: PackageJson = { name: 'my-pkg', keywords: [] }
    const m = buildStubManifest(source, 'public') as Record<string, unknown>
    assert.ok(!('keywords' in m))
  })
})

describe('writeStubDir + verifyStubDir', () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'stub-dir-'))
  })
  after(async () => {
    await rm(dir, { recursive: true })
  })

  test('writes exactly package.json, index.js, README.md', async () => {
    const manifest = buildStubManifest({ name: 'my-pkg', description: 'Test' }, 'public')
    await writeStubDir(dir, manifest)
    const files = (await readdir(dir)).sort()
    assert.deepStrictEqual(files, ['README.md', 'index.js', 'package.json'])
  })

  test('index.js contains module.exports = {}', async () => {
    const content = await readFile(join(dir, 'index.js'), 'utf8')
    assert.ok(content.includes('module.exports'))
  })

  test('package.json in stub dir has version 0.0.0', async () => {
    const raw = await readFile(join(dir, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version: string }
    assert.strictEqual(parsed.version, '0.0.0')
  })

  test('verifyStubDir passes on correct contents', async () => {
    await assert.doesNotReject(() => verifyStubDir(dir))
  })

  test('verifyStubDir throws when unexpected file present', async () => {
    await writeFile(join(dir, 'extra.js'), '')
    await assert.rejects(() => verifyStubDir(dir), /unexpected/i)
  })
})
