import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMockRegistry } from './helpers/mock_registry.ts'
import { createMockPM } from './helpers/mock_pm.ts'
import main, { formatSuccessUrl, detectRepositoryUrl } from '../src/cli.ts'

// Helper: run the CLI with full isolation
async function runCLI(opts: {
  argv?: string[]
  pkgJson?: Record<string, unknown>
  knownPackages?: string[]
  pmName?: 'npm' | 'pnpm'
  pmExitCode?: number
  userAgent?: string
}): Promise<{
  code: number
  out: string[]
  err: string[]
  cwd: string
  pm: Awaited<ReturnType<typeof createMockPM>>
  reg: Awaited<ReturnType<typeof createMockRegistry>>
}> {
  const cwd = await mkdtemp(join(tmpdir(), 'cli-test-'))
  const pkg = opts.pkgJson ?? { name: 'test-pkg', version: '1.0.0' }
  await writeFile(join(cwd, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

  const reg = await createMockRegistry(opts.knownPackages ?? [])
  const pm = await createMockPM(opts.pmName ?? 'npm')
  if (opts.pmExitCode !== undefined) await pm.setExitCode(opts.pmExitCode)

  const out: string[] = []
  const err: string[] = []

  const argv = ['--cwd', cwd, '--registry', reg.url, ...(opts.argv ?? [])]

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${pm.binDir}:${process.env['PATH']}`,
    npm_config_user_agent: opts.userAgent,
  }

  const code = await main({ argv, log: (m) => out.push(m), err: (m) => err.push(m), env })

  return { code, out, err, cwd, pm, reg }
}

async function cleanup(ctx: {
  cwd: string
  pm: { [Symbol.asyncDispose](): Promise<void> }
  reg: { close(): Promise<void> }
}) {
  await rm(ctx.cwd, { recursive: true, force: true })
  await ctx.pm[Symbol.asyncDispose]()
  await ctx.reg.close()
}

// ── Package already exists ────────────────────────────────────────────────

test('package already on registry → exit 0, source unchanged', async () => {
  const originalPkg = { name: 'test-pkg', version: '1.0.0' }
  const ctx = await runCLI({ pkgJson: originalPkg, knownPackages: ['test-pkg'] })
  try {
    assert.strictEqual(ctx.code, 0)
    assert.ok(ctx.out.some((l) => l.includes('already published')))
    const calls = await ctx.pm.getCalls()
    assert.strictEqual(calls.length, 0)
    // Source package.json unchanged
    const raw = await readFile(join(ctx.cwd, 'package.json'), 'utf8')
    assert.deepStrictEqual(JSON.parse(raw), originalPkg)
  } finally {
    await cleanup(ctx)
  }
})

// ── Normal new package publish ────────────────────────────────────────────

test('new package, no private, no flags → writes access:public, publishes', async () => {
  const ctx = await runCLI({ pkgJson: { name: 'test-pkg', version: '1.0.0' } })
  try {
    assert.strictEqual(ctx.code, 0)
    const pkg = JSON.parse(await readFile(join(ctx.cwd, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
    assert.deepStrictEqual((pkg['publishConfig'] as Record<string, unknown>)['access'], 'public')
    const calls = await ctx.pm.getCalls()
    assert.strictEqual(calls.length, 1)
    assert.strictEqual(calls[0]![0], 'publish')
  } finally {
    await cleanup(ctx)
  }
})

test('new package, private:true → writes access:restricted, publishes', async () => {
  const ctx = await runCLI({ pkgJson: { name: 'test-pkg', version: '1.0.0', private: true } })
  try {
    assert.strictEqual(ctx.code, 0)
    const pkg = JSON.parse(await readFile(join(ctx.cwd, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
    assert.deepStrictEqual(
      (pkg['publishConfig'] as Record<string, unknown>)['access'],
      'restricted'
    )
  } finally {
    await cleanup(ctx)
  }
})

// ── --dry-run ─────────────────────────────────────────────────────────────

test('--dry-run never writes source and never publishes', async () => {
  const original = { name: 'test-pkg', version: '1.0.0' }
  const ctx = await runCLI({ pkgJson: original, argv: ['--dry-run'] })
  try {
    assert.strictEqual(ctx.code, 0)
    const raw = JSON.parse(await readFile(join(ctx.cwd, 'package.json'), 'utf8'))
    assert.deepStrictEqual(raw, original)
    const calls = await ctx.pm.getCalls()
    assert.strictEqual(calls.length, 0)
  } finally {
    await cleanup(ctx)
  }
})

test('-n is alias for --dry-run', async () => {
  const ctx = await runCLI({ argv: ['-n'] })
  try {
    assert.strictEqual(ctx.code, 0)
    const calls = await ctx.pm.getCalls()
    assert.strictEqual(calls.length, 0)
  } finally {
    await cleanup(ctx)
  }
})

// ── Bad args ──────────────────────────────────────────────────────────────

test('invalid --access value → exit 2', async () => {
  const ctx = await runCLI({ argv: ['--access', 'weird'] })
  try {
    assert.strictEqual(ctx.code, 2)
  } finally {
    await cleanup(ctx)
  }
})

test('--dry-run + --no-publish together → exit 2', async () => {
  const ctx = await runCLI({ argv: ['--dry-run', '--no-publish'] })
  try {
    assert.strictEqual(ctx.code, 2)
  } finally {
    await cleanup(ctx)
  }
})

test('--force bypasses already-published exit', async () => {
  const ctx = await runCLI({
    pkgJson: { name: 'test-pkg', version: '1.0.0' },
    knownPackages: ['test-pkg'],
    argv: ['--force'],
  })
  try {
    assert.ok(!ctx.out.some((l) => l.includes('nothing to do')))
    const calls = await ctx.pm.getCalls()
    assert.ok(calls.length > 0, 'publish should have been called')
  } finally {
    await cleanup(ctx)
  }
})

// ── publish exit code propagation ─────────────────────────────────────────

test('npm publish exits non-zero → propagate that exit code', async () => {
  const ctx = await runCLI({ pmExitCode: 42 })
  try {
    assert.strictEqual(ctx.code, 42)
  } finally {
    await cleanup(ctx)
  }
})

// ── Scoped packages ───────────────────────────────────────────────────────

test('@org/foo → registry check encodes correctly, tarball is org-foo-0.0.0.tgz', async () => {
  const ctx = await runCLI({
    pkgJson: { name: '@org/foo', version: '1.0.0' },
    argv: ['--access', 'public'],
  })
  try {
    assert.strictEqual(ctx.code, 0)
    const calls = await ctx.pm.getCalls()
    assert.ok(calls[0]![1]!.endsWith('org-foo-0.0.0.tgz'))
  } finally {
    await cleanup(ctx)
  }
})

// ── Indent preservation ───────────────────────────────────────────────────

test('4-space indent preserved after writing publishConfig', async () => {
  const cwd2 = await mkdtemp(join(tmpdir(), 'cli-test-'))
  await writeFile(
    join(cwd2, 'package.json'),
    '{\n    "name": "test-pkg",\n    "version": "1.0.0"\n}\n'
  )
  const reg2 = await createMockRegistry([])
  const pm2 = await createMockPM('npm')
  try {
    const errMsgs: string[] = []
    const code = await main({
      argv: ['--cwd', cwd2, '--registry', reg2.url],
      log: () => {},
      err: (m) => errMsgs.push(m),
      // Explicitly clear npm_config_user_agent so PM detection falls back to npm
      // (inheriting pnpm's user agent from the test runner would cause pnpm detection,
      //  but this test only provides a mock `npm` binary, not `pnpm`).
      env: {
        ...process.env,
        PATH: `${pm2.binDir}:${process.env['PATH']}`,
        npm_config_user_agent: undefined,
      },
    })
    const calls2 = await pm2.getCalls()
    if (code !== 0)
      throw new Error(
        `main() returned ${code}: ${errMsgs.join('; ')}; pm calls=${JSON.stringify(calls2)}`
      )
    const written = await readFile(join(cwd2, 'package.json'), 'utf8')
    assert.ok(written.includes('\n    "publishConfig"'), '4-space indent preserved')
    assert.strictEqual(code, 0)
  } finally {
    await rm(cwd2, { recursive: true })
    await pm2[Symbol.asyncDispose]()
    await reg2.close()
  }
})

// ── Success output ────────────────────────────────────────────────────────

test('success → output contains "Published test-pkg@0.0.0"', async () => {
  const ctx = await runCLI({})
  try {
    assert.ok(ctx.out.some((l) => l.includes('Published test-pkg@0.0.0')))
  } finally {
    await cleanup(ctx)
  }
})

// ── PM detection ──────────────────────────────────────────────────────────

test('packageManager pnpm@9 → spawns pnpm publish --no-git-checks', async () => {
  const ctx = await runCLI({
    pkgJson: { name: 'test-pkg', version: '1.0.0', packageManager: 'pnpm@9.0.0' },
    pmName: 'pnpm',
  })
  try {
    const calls = await ctx.pm.getCalls()
    assert.ok(calls[0]!.includes('--no-git-checks'))
  } finally {
    await cleanup(ctx)
  }
})

test('packageManager yarn@4 → exit 1 with unsupported message', async () => {
  const ctx = await runCLI({
    pkgJson: { name: 'test-pkg', version: '1.0.0', packageManager: 'yarn@4.0.0' },
  })
  try {
    assert.strictEqual(ctx.code, 1)
    assert.ok(ctx.err.some((l) => l.toLowerCase().includes('unsupported')))
    assert.ok(ctx.err.some((l) => l.includes('--no-publish')))
  } finally {
    await cleanup(ctx)
  }
})

test('user-agent pnpm/ → uses pnpm', async () => {
  const ctx = await runCLI({ pmName: 'pnpm', userAgent: 'pnpm/9.1.0 npm/10.0.0 node/v24.0.0' })
  try {
    const calls = await ctx.pm.getCalls()
    assert.ok(calls[0]!.includes('--no-git-checks'))
  } finally {
    await cleanup(ctx)
  }
})

// ── --no-publish ──────────────────────────────────────────────────────────

test('--no-publish → writes source, packs tarball to cwd, does not publish', async () => {
  const ctx = await runCLI({ argv: ['--no-publish'] })
  try {
    assert.strictEqual(ctx.code, 0)
    // publishConfig written to source
    const pkg = JSON.parse(await readFile(join(ctx.cwd, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
    assert.ok('publishConfig' in pkg)
    // tarball in cwd
    const files = await readdir(ctx.cwd)
    assert.ok(files.some((f) => f.endsWith('.tgz')))
    // publish never called
    const noCalls = await ctx.pm.getCalls()
    assert.strictEqual(noCalls.length, 0)
  } finally {
    await cleanup(ctx)
  }
})

test('--no-publish with yarn packageManager → succeeds (bypasses PM check)', async () => {
  const ctx = await runCLI({
    pkgJson: { name: 'test-pkg', version: '1.0.0', packageManager: 'yarn@4.0.0' },
    argv: ['--no-publish'],
  })
  try {
    assert.strictEqual(ctx.code, 0)
  } finally {
    await cleanup(ctx)
  }
})

test('--no-publish tarball name for scoped package is org-foo-0.0.0.tgz', async () => {
  const ctx = await runCLI({
    pkgJson: { name: '@org/foo', version: '1.0.0' },
    argv: ['--no-publish', '--access', 'public'],
  })
  try {
    const files = await readdir(ctx.cwd)
    assert.ok(files.includes('org-foo-0.0.0.tgz'))
  } finally {
    await cleanup(ctx)
  }
})

// ── Scoped package without explicit access → require explicit flag ─────────

test('scoped package, no access flag, no publishConfig → exit 2 with message', async () => {
  const ctx = await runCLI({ pkgJson: { name: '@org/foo', version: '1.0.0' } })
  try {
    assert.strictEqual(ctx.code, 2)
    assert.ok(
      ctx.err.some((l) => l.includes('--access public') && l.includes('--access restricted'))
    )
  } finally {
    await cleanup(ctx)
  }
})

test('scoped package + --access public → publishes (no exit 2)', async () => {
  const ctx = await runCLI({
    pkgJson: { name: '@org/foo', version: '1.0.0' },
    argv: ['--access', 'public'],
  })
  try {
    assert.strictEqual(ctx.code, 0)
    const calls = await ctx.pm.getCalls()
    assert.strictEqual(calls.length, 1)
  } finally {
    await cleanup(ctx)
  }
})

test('scoped package + existing publishConfig.access → no exit 2', async () => {
  const ctx = await runCLI({
    pkgJson: { name: '@org/foo', version: '1.0.0', publishConfig: { access: 'public' } },
  })
  try {
    assert.strictEqual(ctx.code, 0)
  } finally {
    await cleanup(ctx)
  }
})

test('scoped package + private:true → no exit 2 (infers restricted)', async () => {
  const ctx = await runCLI({
    pkgJson: { name: '@org/foo', version: '1.0.0', private: true },
  })
  try {
    assert.strictEqual(ctx.code, 0)
    const pkg = JSON.parse(await readFile(join(ctx.cwd, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
    assert.deepStrictEqual(
      (pkg['publishConfig'] as Record<string, unknown>)['access'],
      'restricted'
    )
  } finally {
    await cleanup(ctx)
  }
})

// ── formatSuccessUrl unit tests ───────────────────────────────────────────

describe('formatSuccessUrl', () => {
  test('public registry → npmjs.com URL', () => {
    const url = formatSuccessUrl('my-pkg', 'https://registry.npmjs.org/')
    assert.strictEqual(url, 'Published my-pkg@0.0.0 → https://www.npmjs.com/package/my-pkg')
  })

  test('scoped package → encoded URL', () => {
    const url = formatSuccessUrl('@org/foo', 'https://registry.npmjs.org/')
    assert.strictEqual(url, 'Published @org/foo@0.0.0 → https://www.npmjs.com/package/@org%2Ffoo')
  })

  test('non-npmjs registry → registry URL in output, no npmjs.com', () => {
    const url = formatSuccessUrl('my-pkg', 'https://my-registry.example.com/')
    assert.ok(url.includes('my-registry.example.com'))
    assert.ok(!url.includes('npmjs.com'))
  })
})

// ── detectRepositoryUrl unit tests ────────────────────────────────────────

describe('detectRepositoryUrl', () => {
  let dir: string

  test('returns null when not in a git repo', async () => {
    dir = await mkdtemp(join(tmpdir(), 'no-git-'))
    const url = detectRepositoryUrl(dir)
    assert.strictEqual(url, null)
    await rm(dir, { recursive: true })
  })

  test('normalises HTTPS remote — strips .git suffix', async () => {
    dir = await mkdtemp(join(tmpdir(), 'test-git-'))
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['init'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/owner/repo.git'], {
      cwd: dir,
    })
    const url = detectRepositoryUrl(dir)
    assert.strictEqual(url, 'https://github.com/owner/repo')
    await rm(dir, { recursive: true })
  })

  test('normalises SSH remote to HTTPS', async () => {
    dir = await mkdtemp(join(tmpdir(), 'test-git-'))
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['init'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:owner/repo.git'], { cwd: dir })
    const url = detectRepositoryUrl(dir)
    assert.strictEqual(url, 'https://github.com/owner/repo')
    await rm(dir, { recursive: true })
  })

  test('strips git+https:// prefix', async () => {
    dir = await mkdtemp(join(tmpdir(), 'test-git-'))
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['init'], { cwd: dir })
    execFileSync('git', ['remote', 'add', 'origin', 'git+https://github.com/owner/repo.git'], {
      cwd: dir,
    })
    const url = detectRepositoryUrl(dir)
    assert.strictEqual(url, 'https://github.com/owner/repo')
    await rm(dir, { recursive: true })
  })
})
