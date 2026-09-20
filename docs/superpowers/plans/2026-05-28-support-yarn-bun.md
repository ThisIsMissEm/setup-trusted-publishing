# Yarn + Bun Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native `yarn publish` (v1), `yarn npm publish` (berry), and `bun publish` support to the package manager detection and publish pipeline.

**Architecture:** Extend `SupportedPM` with three new values, add a `resolveYarn` version splitter, teach `runPublish` to spawn the right binary/args/cwd per PM, and add `stubDir` to `RunPublishOptions` (needed because yarn-berry and bun publish from a directory, not a tarball path). Wire through to `cli.ts` which already has `tempPath` available.

**Tech Stack:** Node.js, TypeScript 6, node:child_process spawn, existing mock PM test helper

---

## File Map

| File                             | Change                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/registry.ts`                | Extend `SupportedPM`, add `resolveYarn`, update `detectPackageManager`, add `stubDir` to `RunPublishOptions`, update `runPublish` switch |
| `src/cli.ts`                     | Pass `stubDir: tempPath` to `runPublish`; update `--no-publish` example command                                                          |
| `tests/helpers/mock_pm.ts`       | Accept `'yarn' \| 'bun'` in `createMockPM`                                                                                               |
| `tests/registry.test.ts`         | Update 2 existing yarn tests; add yarn-v1, yarn-berry, bun detection + publish tests                                                     |
| `tests/cli.test.ts`              | Update yarn-unsupported test; add yarn-v1, yarn-berry, bun CLI integration tests                                                         |
| `.changeset/yarn-bun-support.md` | New `minor` changeset                                                                                                                    |

---

## Key Design Notes

**Yarn v1 vs berry detection** — extract major version from `packageManager` field or user agent:

- `yarn@1.x` / `yarn/1.x ...` → `yarn-v1`
- `yarn@2+` / `yarn/2+ ...` → `yarn-berry`

**Publish commands:**

| PM           | Binary | Args                | spawn cwd    | Registry flag                 |
| ------------ | ------ | ------------------- | ------------ | ----------------------------- |
| `yarn-v1`    | `yarn` | `publish <tarball>` | source `cwd` | `--registry <url>`            |
| `yarn-berry` | `yarn` | `npm publish`       | `stubDir`    | `npm_config_registry` env var |
| `bun`        | `bun`  | `publish`           | `stubDir`    | `--registry <url>`            |

Note: yarn berry does not accept `--registry` as a CLI flag — registry is passed via the `YARN_NPM_REGISTRY_SERVER` environment variable instead. Verified: `npm_config_registry` and `NPM_CONFIG_REGISTRY` are both ignored by yarn berry.

---

### Task 1: Extend detection — `SupportedPM`, `resolveYarn`, `detectPackageManager`

**Files:**

- Modify: `src/registry.ts` (lines 6–41)
- Test: `tests/registry.test.ts` (describe `detectPackageManager`)

- [ ] **Step 1: Update the two existing yarn tests that currently expect `unsupported`**

In `tests/registry.test.ts`, find and replace these two tests:

```ts
test('packageManager: yarn@4.0.0 → yarn-berry', () => {
  const r = detectPackageManager('yarn@4.0.0', undefined)
  assert.deepStrictEqual(r, { pm: 'yarn-berry', source: 'packageManager-field' })
})

test('user-agent starts with yarn/ → yarn-berry', () => {
  const r = detectPackageManager(undefined, 'yarn/4.15.0 npm/? node/v22.22.3 linux arm64')
  assert.deepStrictEqual(r, { pm: 'yarn-berry', source: 'user-agent' })
})
```

- [ ] **Step 2: Run the two updated tests and confirm they fail**

```sh
pnpm test:file tests/registry.test.ts 2>&1 | grep " error TS\|✖\|failing"
```

Expected: 2 failures (values are still `unsupported: 'yarn'`).

- [ ] **Step 3: Implement the changes in `src/registry.ts`**

Replace the `SupportedPM` type, add `resolveYarn`, and update `detectPackageManager`:

```ts
export type SupportedPM = 'npm' | 'pnpm' | 'yarn-v1' | 'yarn-berry' | 'bun'

function resolveYarn(version: string): SupportedPM {
  return parseInt(version.split('.')[0] ?? '0', 10) < 2 ? 'yarn-v1' : 'yarn-berry'
}

export function detectPackageManager(
  packageManagerField: string | undefined,
  userAgent: string | undefined
): PMDetectionResult {
  // 1. packageManager field
  if (packageManagerField) {
    const [name = '', version = ''] = packageManagerField.split('@')
    if (name === 'npm') return { pm: 'npm', source: 'packageManager-field' }
    if (name === 'pnpm') return { pm: 'pnpm', source: 'packageManager-field' }
    if (name === 'yarn') return { pm: resolveYarn(version), source: 'packageManager-field' }
    if (name === 'bun') return { pm: 'bun', source: 'packageManager-field' }
    return { pm: null, unsupported: name }
  }

  // 2. npm_config_user_agent
  if (userAgent) {
    if (userAgent.startsWith('pnpm/')) return { pm: 'pnpm', source: 'user-agent' }
    if (userAgent.startsWith('bun/')) return { pm: 'bun', source: 'user-agent' }
    if (userAgent.startsWith('yarn/')) {
      const version = userAgent.slice('yarn/'.length).split(' ')[0] ?? ''
      return { pm: resolveYarn(version), source: 'user-agent' }
    }
    return { pm: 'npm', source: 'user-agent' }
  }

  // 3. Fallback
  return { pm: 'npm', source: 'fallback' }
}
```

- [ ] **Step 4: Add the remaining new detection tests**

Append inside the `describe('detectPackageManager', ...)` block:

```ts
test('packageManager: yarn@1.22.0 → yarn-v1', () => {
  const r = detectPackageManager('yarn@1.22.0', undefined)
  assert.deepStrictEqual(r, { pm: 'yarn-v1', source: 'packageManager-field' })
})

test('packageManager: yarn@2.0.0 → yarn-berry', () => {
  const r = detectPackageManager('yarn@2.0.0', undefined)
  assert.deepStrictEqual(r, { pm: 'yarn-berry', source: 'packageManager-field' })
})

test('packageManager: bun@1.0.0 → bun', () => {
  const r = detectPackageManager('bun@1.0.0', undefined)
  assert.deepStrictEqual(r, { pm: 'bun', source: 'packageManager-field' })
})

test('user-agent starts with yarn/1. → yarn-v1', () => {
  const r = detectPackageManager(undefined, 'yarn/1.22.22 npm/? node/v22.22.3 linux arm64')
  assert.deepStrictEqual(r, { pm: 'yarn-v1', source: 'user-agent' })
})

test('user-agent starts with bun/ → bun', () => {
  const r = detectPackageManager(undefined, 'bun/1.3.14 npm/? node/v24.3.0 linux arm64')
  assert.deepStrictEqual(r, { pm: 'bun', source: 'user-agent' })
})
```

- [ ] **Step 5: Run all detection tests and confirm they pass**

```sh
pnpm test:file tests/registry.test.ts 2>&1 | grep -E "✔|✖|ℹ"
```

Expected: all `detectPackageManager` tests pass.

- [ ] **Step 6: Commit**

```sh
git add src/registry.ts tests/registry.test.ts
git commit -m "feat: extend package manager detection for yarn v1, yarn berry, and bun"
```

---

### Task 2: Extend mock PM helper

**Files:**

- Modify: `tests/helpers/mock_pm.ts`

Two changes: widen the accepted PM type, and add env var recording so the yarn-berry registry test can verify `YARN_NPM_REGISTRY_SERVER` is forwarded.

- [ ] **Step 1: Add `getEnvCalls()` to the `MockPM` interface and implementation**

Replace the full file:

```ts
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export interface MockPM {
  /** Prepend this to PATH when running the CLI under test */
  binDir: string
  /** Returns all recorded invocation arg arrays, in order */
  getCalls(): Promise<string[][]>
  /** Returns the process.env recorded for each invocation, in order */
  getEnvCalls(): Promise<NodeJS.ProcessEnv[]>
  /** Set the exit code the next (and subsequent) invocations will return */
  setExitCode(code: number): Promise<void>
  /** Set text to write to stderr on the next (and subsequent) invocations */
  setStderr(text: string): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

/**
 * Creates a fake npm, pnpm, yarn, or bun binary in a temp directory.
 *
 * The binary:
 *   - records process.argv.slice(2) as a JSON line to a calls file
 *   - records process.env as a JSON line to an env-calls file
 *   - exits with the code written to an exit-code file (default 0)
 */
export async function createMockPM(pm: 'npm' | 'pnpm' | 'yarn' | 'bun' = 'npm'): Promise<MockPM> {
  const dir = await mkdtemp(join(tmpdir(), 'mock-pm-'))
  const callsFile = join(dir, 'calls.ndjson')
  const envCallsFile = join(dir, 'env-calls.ndjson')
  const exitCodeFile = join(dir, 'exit-code')
  const stderrFile = join(dir, 'stderr')

  const scriptContent = `#!/usr/bin/env node
const { appendFileSync, readFileSync, existsSync } = require('node:fs');

appendFileSync(
  ${JSON.stringify(callsFile)},
  JSON.stringify(process.argv.slice(2)) + '\\n',
  'utf8'
);

appendFileSync(
  ${JSON.stringify(envCallsFile)},
  JSON.stringify(process.env) + '\\n',
  'utf8'
);

if (existsSync(${JSON.stringify(stderrFile)})) {
  process.stderr.write(readFileSync(${JSON.stringify(stderrFile)}, 'utf8'));
}

const exitCode = existsSync(${JSON.stringify(exitCodeFile)})
  ? parseInt(readFileSync(${JSON.stringify(exitCodeFile)}, 'utf8').trim(), 10)
  : 0;

process.exit(isNaN(exitCode) ? 0 : exitCode);
`

  await writeFile(join(dir, pm), scriptContent, { mode: 0o755 })

  return {
    binDir: dir,

    async getCalls(): Promise<string[][]> {
      try {
        const content = await readFile(callsFile, 'utf8')
        return content
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as string[])
      } catch {
        return []
      }
    },

    async getEnvCalls(): Promise<NodeJS.ProcessEnv[]> {
      try {
        const content = await readFile(envCallsFile, 'utf8')
        return content
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as NodeJS.ProcessEnv)
      } catch {
        return []
      }
    },

    async setExitCode(code: number): Promise<void> {
      await writeFile(exitCodeFile, String(code), 'utf8')
    },

    async setStderr(text: string): Promise<void> {
      await writeFile(stderrFile, text, 'utf8')
    },

    async [Symbol.asyncDispose](): Promise<void> {
      await rm(dir, { recursive: true, force: true })
    },
  }
}
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

```sh
pnpm test 2>&1 | grep -E "^(ℹ|✖)"
```

Expected: all pass.

- [ ] **Step 3: Commit**

```sh
git add tests/helpers/mock_pm.ts
git commit -m "test: extend createMockPM — yarn/bun types, env var recording"
```

---

### Task 3: Extend `runPublish` for yarn and bun

**Files:**

- Modify: `src/registry.ts` (`RunPublishOptions`, `runPublish`)
- Test: `tests/registry.test.ts` (describe `runPublish`)

- [ ] **Step 1: Write the failing tests for the three new PMs**

Append inside `describe('runPublish', ...)` in `tests/registry.test.ts`:

```ts
test('spawns yarn publish <tarball> for yarn-v1', async () => {
  await using pm = await createMockPM('yarn')
  const tarball = join(tmpdir(), 'test-0.0.0.tgz')
  await writeFile(tarball, 'fake tarball content')

  const result = await runPublish({
    pm: 'yarn-v1',
    tarballPath: tarball,
    stubDir: tmpdir(),
    cwd: tmpdir(),
    env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
  })

  assert.strictEqual(result.exitCode, 0)
  const calls = await pm.getCalls()
  assert.strictEqual(calls[0]![0], 'publish')
  assert.strictEqual(calls[0]![1], tarball)
})

test('spawns yarn npm publish for yarn-berry (no tarball arg)', async () => {
  await using pm = await createMockPM('yarn')
  const tarball = join(tmpdir(), 'test-0.0.0.tgz')
  await writeFile(tarball, 'fake tarball content')

  const result = await runPublish({
    pm: 'yarn-berry',
    tarballPath: tarball,
    stubDir: tmpdir(),
    cwd: tmpdir(),
    env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
  })

  assert.strictEqual(result.exitCode, 0)
  const calls = await pm.getCalls()
  assert.deepStrictEqual(calls[0], ['npm', 'publish'])
})

test('spawns bun publish (no tarball arg)', async () => {
  await using pm = await createMockPM('bun')
  const tarball = join(tmpdir(), 'test-0.0.0.tgz')
  await writeFile(tarball, 'fake tarball content')

  const result = await runPublish({
    pm: 'bun',
    tarballPath: tarball,
    stubDir: tmpdir(),
    cwd: tmpdir(),
    env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
  })

  assert.strictEqual(result.exitCode, 0)
  const calls = await pm.getCalls()
  assert.deepStrictEqual(calls[0], ['publish'])
})

test('yarn-v1 forwards --registry', async () => {
  await using pm = await createMockPM('yarn')
  const tarball = join(tmpdir(), 'test-0.0.0.tgz')
  await writeFile(tarball, 'fake tarball content')

  await runPublish({
    pm: 'yarn-v1',
    tarballPath: tarball,
    stubDir: tmpdir(),
    cwd: tmpdir(),
    registry: 'https://example.com',
    env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
  })

  const calls = await pm.getCalls()
  assert.ok(calls[0]!.includes('https://example.com'))
})

test('yarn-berry forwards registry via YARN_NPM_REGISTRY_SERVER env var', async () => {
  await using pm = await createMockPM('yarn')
  const tarball = join(tmpdir(), 'test-0.0.0.tgz')
  await writeFile(tarball, 'fake tarball content')

  await runPublish({
    pm: 'yarn-berry',
    tarballPath: tarball,
    stubDir: tmpdir(),
    cwd: tmpdir(),
    registry: 'https://example.com',
    env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
  })

  const envCalls = await pm.getEnvCalls()
  assert.strictEqual(envCalls[0]!['YARN_NPM_REGISTRY_SERVER'], 'https://example.com')
})

test('bun forwards --registry', async () => {
  await using pm = await createMockPM('bun')
  const tarball = join(tmpdir(), 'test-0.0.0.tgz')
  await writeFile(tarball, 'fake tarball content')

  await runPublish({
    pm: 'bun',
    tarballPath: tarball,
    stubDir: tmpdir(),
    cwd: tmpdir(),
    registry: 'https://example.com',
    env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
  })

  const calls = await pm.getCalls()
  assert.ok(calls[0]!.some((a) => a.includes('example.com')))
})
```

Also update all existing `runPublish` tests to add `stubDir: tmpdir()` to their options objects (the field will be required after the next step).

- [ ] **Step 2: Run tests to confirm they fail**

```sh
pnpm test:file tests/registry.test.ts 2>&1 | grep " error TS\|✖\|failing"
```

Expected: TypeScript error on missing `stubDir`, plus runtime failures for the new PM tests.

- [ ] **Step 3: Implement `RunPublishOptions` and `runPublish` changes in `src/registry.ts`**

Replace the `RunPublishOptions` interface and `runPublish` function:

```ts
export interface RunPublishOptions {
  pm: SupportedPM
  tarballPath: string
  /** Directory containing the stub package.json — used by yarn-berry and bun which publish from a dir */
  stubDir: string
  cwd: string
  registry?: string
  /** Override process.env for testing; defaults to process.env */
  env?: NodeJS.ProcessEnv
}

export async function runPublish(opts: RunPublishOptions): Promise<RunPublishResult> {
  const { pm, tarballPath, stubDir, cwd, registry, env: baseEnv } = opts

  let bin: string
  let args: string[]
  let spawnCwd: string
  let extraEnv: Record<string, string> | undefined

  switch (pm) {
    case 'npm':
      bin = 'npm'
      args = ['publish', tarballPath]
      if (registry) args.push(`--registry=${registry}`)
      spawnCwd = cwd
      break
    case 'pnpm':
      bin = 'pnpm'
      args = ['publish', tarballPath, '--no-git-checks']
      if (registry) args.push(`--registry=${registry}`)
      spawnCwd = cwd
      break
    case 'yarn-v1':
      bin = 'yarn'
      args = ['publish', tarballPath]
      if (registry) args.push('--registry', registry)
      spawnCwd = cwd
      break
    case 'yarn-berry':
      bin = 'yarn'
      args = ['npm', 'publish']
      // yarn berry has no --registry CLI flag; pass via YARN_NPM_REGISTRY_SERVER env var
      if (registry) extraEnv = { YARN_NPM_REGISTRY_SERVER: registry }
      spawnCwd = stubDir
      break
    case 'bun':
      bin = 'bun'
      args = ['publish']
      if (registry) args.push('--registry', registry)
      spawnCwd = stubDir
      break
  }

  const env = extraEnv ? { ...(baseEnv ?? process.env), ...extraEnv } : (baseEnv ?? process.env)

  return new Promise((resolve, reject) => {
    let sawE404 = false
    let sawPut = false

    const stderrSpy = new PassThrough()
    stderrSpy.on('data', (chunk: Buffer) => {
      if (sawE404 && sawPut) return
      const text = chunk.toString('utf8')
      if (!sawE404 && text.includes('E404')) sawE404 = true
      if (sawE404 && !sawPut && text.includes(' PUT ')) sawPut = true
    })

    const child = spawn(bin, args, {
      cwd: spawnCwd,
      stdio: ['inherit', 'inherit', 'pipe'],
      env,
    })

    // stdio[2] === 'pipe' guarantees child.stderr is a Readable, not null
    child.stderr!.pipe(stderrSpy).pipe(process.stderr)

    child.on('exit', (code) =>
      resolve({ exitCode: code ?? 1, looksLikeAuthError: sawE404 && sawPut })
    )
    child.on('error', reject)
  })
}
```

- [ ] **Step 4: Run all registry tests and confirm they pass**

```sh
pnpm test:file tests/registry.test.ts 2>&1 | grep -E "✔|✖|ℹ"
```

Expected: all pass.

- [ ] **Step 5: Commit**

```sh
git add src/registry.ts tests/registry.test.ts
git commit -m "feat: add yarn-v1, yarn-berry, and bun publish support"
```

---

### Task 4: Wire through in `cli.ts`

**Files:**

- Modify: `src/cli.ts` (two changes)
- Test: `tests/cli.test.ts`

Changes needed:

1. Pass `stubDir: tempPath` to `runPublish`
2. Update the `--no-publish` example command to be PM-aware

- [ ] **Step 1: Write the failing CLI integration tests**

Append to `tests/cli.test.ts`:

```ts
test('packageManager yarn@1.22.0 → spawns yarn publish', async () => {
  const ctx = await runCLI({
    pkgJson: { name: 'test-pkg', version: '1.0.0', packageManager: 'yarn@1.22.0' },
    pmName: 'yarn',
  })
  try {
    assert.strictEqual(ctx.code, 0)
    const calls = await ctx.pm.getCalls()
    assert.ok(calls.length > 0)
    assert.strictEqual(calls[0]![0], 'publish')
  } finally {
    await cleanup(ctx)
  }
})

test('packageManager yarn@4.0.0 → spawns yarn npm publish', async () => {
  const ctx = await runCLI({
    pkgJson: { name: 'test-pkg', version: '1.0.0', packageManager: 'yarn@4.0.0' },
    pmName: 'yarn',
  })
  try {
    assert.strictEqual(ctx.code, 0)
    const calls = await ctx.pm.getCalls()
    assert.ok(calls.length > 0)
    assert.deepStrictEqual(calls[0], ['npm', 'publish'])
  } finally {
    await cleanup(ctx)
  }
})

test('packageManager bun@1.0.0 → spawns bun publish', async () => {
  const ctx = await runCLI({
    pkgJson: { name: 'test-pkg', version: '1.0.0', packageManager: 'bun@1.0.0' },
    pmName: 'bun',
  })
  try {
    assert.strictEqual(ctx.code, 0)
    const calls = await ctx.pm.getCalls()
    assert.deepStrictEqual(calls[0], ['publish'])
  } finally {
    await cleanup(ctx)
  }
})
```

Also update the existing `'packageManager yarn@4 → exit 1 with unsupported message'` test — it should now expect exit code 0 (yarn-berry is supported) and verify publish was called.

- [ ] **Step 2: Extend `runCLI` helper to accept `'yarn' | 'bun'` as `pmName`**

In `tests/cli.test.ts`, update the `runCLI` options type and the `createMockPM` call:

```ts
async function runCLI(opts: {
  argv?: string[]
  pkgJson?: Record<string, unknown>
  knownPackages?: string[]
  pmName?: 'npm' | 'pnpm' | 'yarn' | 'bun'
  pmExitCode?: number
  userAgent?: string
})
```

The `createMockPM(opts.pmName ?? 'npm')` call already passes through — no other change needed since `mock_pm.ts` now accepts `'yarn' | 'bun'`.

- [ ] **Step 3: Run failing tests to confirm they fail**

```sh
pnpm test:file tests/cli.test.ts 2>&1 | grep " error TS\|✖\|failing"
```

Expected: TypeScript error on `pmName: 'yarn'` (mock_pm type not updated yet in cli tests) and runtime failures.

- [ ] **Step 4: Update `runPublish` call in `src/cli.ts`**

Find the `runPublish` call (Step 15) and add `stubDir`:

```ts
const result = await runPublish({ pm, tarballPath, stubDir: tempPath, cwd, registry, env })
```

- [ ] **Step 5: Update the `--no-publish` example command to be PM-aware**

Replace the hardcoded `yarn npm publish` example in the `--no-publish` block with a PM-aware one. The block already builds `realTarballPath` — add the switch after it:

```ts
const prefix = cwd === process.cwd() ? './' : cwd
const realTarballPath = path.join(prefix, tarballName)
log(`Stub packed to into: ${realTarballPath}\n`)
log(`Run your publish command to complete the initial publish, e.g.,\n`)
const pm = pmDetection.pm
if (pm === 'yarn-v1') {
  log(`  yarn publish ${realTarballPath}`)
} else if (pm === 'yarn-berry') {
  log(`  yarn npm publish ${realTarballPath}`)
} else if (pm === 'bun') {
  log(`  bun publish ${realTarballPath}`)
} else if (pm === 'pnpm') {
  log(`  pnpm publish ${realTarballPath}`)
} else {
  log(`  npm publish ${realTarballPath}`)
}
```

- [ ] **Step 6: Run the full test suite and confirm all pass**

```sh
pnpm test 2>&1 | grep -E "^(ℹ|✖)"
```

Expected: all pass, no TypeScript errors (`pnpm typecheck` clean).

- [ ] **Step 7: Commit**

```sh
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: wire yarn-v1, yarn-berry, bun through CLI; PM-aware --no-publish hint"
```

---

### Task 5: Changeset and final checks

**Files:**

- Create: `.changeset/yarn-bun-support.md`

- [ ] **Step 1: Create the changeset**

```markdown
---
'setup-trusted-publishing': minor
---

Add native publish support for yarn (v1 and berry) and bun.

Previously these package managers required `--no-publish` and manual publishing. They are now detected automatically and the correct publish command is invoked:

- yarn v1: `yarn publish <tarball>`
- yarn berry: `yarn npm publish` (run from stub directory)
- bun: `bun publish` (run from stub directory)

The `--no-publish` example command is also now tailored to the detected package manager.
```

- [ ] **Step 2: Run full suite + typecheck one final time**

```sh
pnpm lint && pnpm test 2>&1 | grep -E "^(ℹ|✖)"
```

Expected: lint clean, all tests pass.

- [ ] **Step 3: Commit**

```sh
git add .changeset/yarn-bun-support.md
git commit -m "chore: add changeset for yarn and bun support"
```
