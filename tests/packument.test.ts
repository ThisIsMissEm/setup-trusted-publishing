import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readPackage, writePackageFields } from '../src/packument.ts'

describe('readPackage', () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'test-pkg-'))
  })
  after(async () => {
    await rm(dir, { recursive: true })
  })

  test('reads name, version, indent (2 spaces)', async () => {
    await writeFile(join(dir, 'package.json'), '{\n  "name": "foo",\n  "version": "1.0.0"\n}\n')
    const r = await readPackage(dir)
    assert.strictEqual(r.parsed.name, 'foo')
    assert.strictEqual(r.indent, '  ')
    assert.strictEqual(r.hasTrailingNewline, true)
  })

  test('detects 4-space indent', async () => {
    await writeFile(join(dir, 'package.json'), '{\n    "name": "bar"\n}\n')
    const r = await readPackage(dir)
    assert.strictEqual(r.indent, '    ')
  })

  test('detects tab indent', async () => {
    await writeFile(join(dir, 'package.json'), '{\n\t"name": "baz"\n}\n')
    const r = await readPackage(dir)
    assert.strictEqual(r.indent, '\t')
  })

  test('detects missing trailing newline', async () => {
    await writeFile(join(dir, 'package.json'), '{\n  "name": "qux"\n}')
    const r = await readPackage(dir)
    assert.strictEqual(r.hasTrailingNewline, false)
  })

  test('defaults to 2-space indent when undetectable', async () => {
    await writeFile(join(dir, 'package.json'), '{"name":"minimal"}')
    const r = await readPackage(dir)
    assert.strictEqual(r.indent, '  ')
  })
})

describe('writePackageFields', () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'test-pkg-'))
  })
  after(async () => {
    await rm(dir, { recursive: true })
  })

  test('adds publishConfig.access when absent, preserves 2-space indent + trailing newline', async () => {
    const original = '{\n  "name": "foo",\n  "version": "1.0.0"\n}\n'
    await writeFile(join(dir, 'package.json'), original)
    const r = await readPackage(dir)
    await writePackageFields(dir, r, { publishConfig: { access: 'public' } })
    const written = await readFile(join(dir, 'package.json'), 'utf8')
    const parsed = JSON.parse(written) as Record<string, unknown>
    assert.deepStrictEqual((parsed['publishConfig'] as Record<string, unknown>)['access'], 'public')
    assert.ok(written.endsWith('\n'), 'trailing newline preserved')
    assert.ok(written.includes('\n  "publishConfig"'), '2-space indent preserved')
  })

  test('preserves tab indent', async () => {
    await writeFile(join(dir, 'package.json'), '{\n\t"name": "bar"\n}\n')
    const r = await readPackage(dir)
    await writePackageFields(dir, r, { publishConfig: { access: 'restricted' } })
    const written = await readFile(join(dir, 'package.json'), 'utf8')
    assert.ok(written.includes('\n\t"publishConfig"'), 'tab indent preserved')
  })

  test('preserves absence of trailing newline', async () => {
    await writeFile(join(dir, 'package.json'), '{\n  "name": "baz"\n}')
    const r = await readPackage(dir)
    await writePackageFields(dir, r, { publishConfig: { access: 'public' } })
    const written = await readFile(join(dir, 'package.json'), 'utf8')
    assert.ok(!written.endsWith('\n'), 'no trailing newline preserved')
  })

  test('merges into existing publishConfig preserving other keys', async () => {
    const original =
      '{\n  "name": "foo",\n  "publishConfig": {\n    "registry": "https://example.com"\n  }\n}\n'
    await writeFile(join(dir, 'package.json'), original)
    const r = await readPackage(dir)
    await writePackageFields(dir, r, { publishConfig: { access: 'restricted' } })
    const written = await readFile(join(dir, 'package.json'), 'utf8')
    const parsed = JSON.parse(written) as { publishConfig: Record<string, unknown> }
    assert.strictEqual(parsed.publishConfig['access'], 'restricted')
    assert.strictEqual(parsed.publishConfig['registry'], 'https://example.com')
  })

  test('overwrites existing publishConfig.access', async () => {
    const original = '{\n  "name": "foo",\n  "publishConfig": { "access": "public" }\n}\n'
    await writeFile(join(dir, 'package.json'), original)
    const r = await readPackage(dir)
    await writePackageFields(dir, r, { publishConfig: { access: 'restricted' } })
    const written = await readFile(join(dir, 'package.json'), 'utf8')
    const parsed = JSON.parse(written) as { publishConfig: Record<string, unknown> }
    assert.strictEqual(parsed.publishConfig['access'], 'restricted')
  })

  test('writes repository field', async () => {
    const original = '{\n  "name": "foo"\n}\n'
    await writeFile(join(dir, 'package.json'), original)
    const r = await readPackage(dir)
    await writePackageFields(dir, r, { repository: 'https://github.com/owner/repo' })
    const written = await readFile(join(dir, 'package.json'), 'utf8')
    const parsed = JSON.parse(written) as Record<string, unknown>
    assert.strictEqual(parsed['repository'], 'https://github.com/owner/repo')
  })

  test('writes publishConfig.provenance and access together', async () => {
    const original = '{\n  "name": "foo"\n}\n'
    await writeFile(join(dir, 'package.json'), original)
    const r = await readPackage(dir)
    await writePackageFields(dir, r, { publishConfig: { access: 'public', provenance: true } })
    const written = await readFile(join(dir, 'package.json'), 'utf8')
    const parsed = JSON.parse(written) as { publishConfig: Record<string, unknown> }
    assert.strictEqual(parsed.publishConfig['access'], 'public')
    assert.strictEqual(parsed.publishConfig['provenance'], true)
  })
})
