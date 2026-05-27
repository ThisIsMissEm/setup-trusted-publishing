import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createMockRegistry } from './helpers/mock_registry.ts'
import { createMockPM } from './helpers/mock_pm.ts'
import { detectPackageManager, packageExists, packStub, runPublish } from '../src/registry.ts'

// ── detectPackageManager ──────────────────────────────────────────────────

describe('detectPackageManager', () => {
  test('no packageManager field, no user agent → npm fallback', () => {
    const r = detectPackageManager(undefined, undefined)
    assert.deepStrictEqual(r, { pm: 'npm', source: 'fallback' })
  })

  test('packageManager: npm@10.0.0 → npm', () => {
    const r = detectPackageManager('npm@10.0.0', undefined)
    assert.deepStrictEqual(r, { pm: 'npm', source: 'packageManager-field' })
  })

  test('packageManager: pnpm@9.0.0 → pnpm', () => {
    const r = detectPackageManager('pnpm@9.0.0', undefined)
    assert.deepStrictEqual(r, { pm: 'pnpm', source: 'packageManager-field' })
  })

  test('packageManager: yarn@4.0.0 → unsupported', () => {
    const r = detectPackageManager('yarn@4.0.0', undefined)
    assert.deepStrictEqual(r, { pm: null, unsupported: 'yarn' })
  })

  test('user-agent starts with pnpm/ → pnpm', () => {
    const r = detectPackageManager(undefined, 'pnpm/9.1.0 npm/10.0.0 node/v24.0.0')
    assert.deepStrictEqual(r, { pm: 'pnpm', source: 'user-agent' })
  })

  test('user-agent starts with npm/ → npm', () => {
    const r = detectPackageManager(undefined, 'npm/10.0.0 node/v24.0.0')
    assert.deepStrictEqual(r, { pm: 'npm', source: 'user-agent' })
  })

  test('user-agent starts with yarn/ → unsupported', () => {
    const r = detectPackageManager(undefined, 'yarn/4.0.0 npm/10.0.0')
    assert.deepStrictEqual(r, { pm: null, unsupported: 'yarn' })
  })
})

// ── packageExists ─────────────────────────────────────────────────────────

describe('packageExists', () => {
  test('returns true for a known package', async () => {
    const reg = await createMockRegistry(['my-pkg'])
    try {
      const result = await packageExists('my-pkg', { registry: reg.url })
      assert.strictEqual(result, true)
    } finally {
      await reg.close()
    }
  })

  test('returns false for an unknown package (404)', async () => {
    const reg = await createMockRegistry([])
    try {
      const result = await packageExists('unknown-pkg', { registry: reg.url })
      assert.strictEqual(result, false)
    } finally {
      await reg.close()
    }
  })

  test('handles scoped package name encoding', async () => {
    const reg = await createMockRegistry(['@org/foo'])
    try {
      const result = await packageExists('@org/foo', { registry: reg.url })
      assert.strictEqual(result, true)
    } finally {
      await reg.close()
    }
  })
})

// ── packStub ──────────────────────────────────────────────────────────────

describe('packStub', () => {
  test('returns a Buffer (the tarball)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pack-test-'))
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'my-pkg', version: '0.0.0' })
      )
      await writeFile(join(dir, 'index.js'), 'module.exports = {};\n')
      await writeFile(join(dir, 'README.md'), '# my-pkg\n')
      const buf = await packStub(dir)
      assert.ok(Buffer.isBuffer(buf))
      assert.ok(buf.length > 0)
    } finally {
      await rm(dir, { recursive: true })
    }
  })
})

// ── runPublish ────────────────────────────────────────────────────────────

describe('runPublish', () => {
  test('spawns npm publish <tarball> and returns exit code 0', async () => {
    await using pm = await createMockPM('npm')
    // Create a dummy tarball file so the mock can verify the path exists
    const tarball = join(tmpdir(), 'test-0.0.0.tgz')
    await writeFile(tarball, 'fake tarball content')

    const result = await runPublish({
      pm: 'npm',
      tarballPath: tarball,
      cwd: tmpdir(),
      env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
    })

    assert.strictEqual(result.exitCode, 0)
    const calls = await pm.getCalls()
    assert.ok(calls.length === 1)
    assert.strictEqual(calls[0]![0], 'publish')
    assert.strictEqual(calls[0]![1], tarball)
  })

  test('spawns pnpm publish <tarball> --no-git-checks', async () => {
    await using pm = await createMockPM('pnpm')
    const tarball = join(tmpdir(), 'test-0.0.0.tgz')
    await writeFile(tarball, 'fake tarball content')

    await runPublish({
      pm: 'pnpm',
      tarballPath: tarball,
      cwd: tmpdir(),
      env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
    })

    const calls = await pm.getCalls()
    assert.ok(calls[0]!.includes('--no-git-checks'))
  })

  test('forwards --registry when provided', async () => {
    await using pm = await createMockPM('npm')
    const tarball = join(tmpdir(), 'test-0.0.0.tgz')
    await writeFile(tarball, 'fake tarball content')

    await runPublish({
      pm: 'npm',
      tarballPath: tarball,
      cwd: tmpdir(),
      registry: 'https://example.com',
      env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
    })

    const calls = await pm.getCalls()
    assert.ok(calls[0]!.some((arg) => arg.includes('example.com')))
  })

  test('propagates non-zero exit code', async () => {
    await using pm = await createMockPM('npm')
    await pm.setExitCode(1)
    const tarball = join(tmpdir(), 'test-0.0.0.tgz')
    await writeFile(tarball, 'fake tarball content')

    const result = await runPublish({
      pm: 'npm',
      tarballPath: tarball,
      cwd: tmpdir(),
      env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
    })

    assert.strictEqual(result.exitCode, 1)
    assert.strictEqual(result.looksLikeAuthError, false)
  })

  test('looksLikeAuthError is true when stderr contains E404 then PUT', async () => {
    await using pm = await createMockPM('npm')
    await pm.setExitCode(1)
    await pm.setStderr(
      'npm error code E404\nnpm error 404 Not Found - PUT https://registry.npmjs.org/my-pkg\n'
    )
    const tarball = join(tmpdir(), 'test-0.0.0.tgz')
    await writeFile(tarball, 'fake tarball content')

    const result = await runPublish({
      pm: 'npm',
      tarballPath: tarball,
      cwd: tmpdir(),
      env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
    })

    assert.strictEqual(result.exitCode, 1)
    assert.strictEqual(result.looksLikeAuthError, true)
  })

  test('looksLikeAuthError is false when stderr has PUT but no E404', async () => {
    await using pm = await createMockPM('npm')
    await pm.setExitCode(1)
    await pm.setStderr('npm error 404 Not Found - PUT https://registry.npmjs.org/my-pkg\n')
    const tarball = join(tmpdir(), 'test-0.0.0.tgz')
    await writeFile(tarball, 'fake tarball content')

    const result = await runPublish({
      pm: 'npm',
      tarballPath: tarball,
      cwd: tmpdir(),
      env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
    })

    assert.strictEqual(result.looksLikeAuthError, false)
  })
})
