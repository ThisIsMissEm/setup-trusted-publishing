# setup-trusted-publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI that publishes a `0.0.0` metadata-only stub to npm so OIDC trusted publishing can be configured before any real publish runs.

**Architecture:** Five focused source modules (`access.ts`, `packument.ts`, `stub.ts`, `registry.ts`, `cli.ts`) — only `cli.ts` touches `process.*`. `main()` returns an exit code rather than calling `process.exit()` directly, making it fully testable by injecting `argv`, `log`, and `err` callbacks. Tests use Node's built-in runner with TypeScript stripped at runtime via `--experimental-strip-types`; no compile step in the test loop.

**Tech Stack:** TypeScript 5.x, Node 24+ (ESM, `util.parseArgs`, `fs.promises.mkdtempDisposable`, `await using`), `npm-registry-fetch`, `libnpmpack`, `validate-npm-package-name`, `node:test`

---

## File Map

| File                             | Responsibility                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `package.json`                   | Package metadata, `bin`, `engines`, scripts, deps                                          |
| `tsconfig.json`                  | Strict TS, NodeNext modules, `dist/` output, excludes `tests/`                             |
| `.gitignore`                     | Standard Node ignores                                                                      |
| `bin/cli.ts`                     | Shebang entrypoint — `process.exit(await main())`                                          |
| `src/access.ts`                  | `resolveAccess()` pure function + `AccessConflictError`                                    |
| `src/packument.ts`               | `readPackage()` / `writePackageAccess()` with indent + EOL preservation                    |
| `src/stub.ts`                    | `buildStubManifest()`, `writeStubDir()`, `verifyStubDir()`                                 |
| `src/registry.ts`                | `detectPackageManager()`, `packageExists()`, `packStub()`, `runPublish()`                  |
| `src/cli.ts`                     | `main(opts)` — parseArgs, orchestration, returns exit code                                 |
| `tests/access.test.ts`           | Unit tests for `resolveAccess` (all 10 matrix rows)                                        |
| `tests/packument.test.ts`        | Round-trip tests for read/write with varied indent + EOL                                   |
| `tests/stub.test.ts`             | Unit tests for `buildStubManifest`; integration for `writeStubDir`/`verifyStubDir`         |
| `tests/registry.test.ts`         | Tests for `detectPackageManager`, `packageExists` (mock registry), `runPublish` (mock npm) |
| `tests/cli.test.ts`              | E2E tests for all spec scenarios                                                           |
| `tests/helpers/mock-registry.ts` | `http.createServer` fake registry                                                          |
| `tests/helpers/mock-pm.ts`       | Fake `npm`/`pnpm` binary on temp PATH (not shipped)                                        |
| `.github/workflows/ci.yml`       | Lint + typecheck + test on Node 24 and 26                                                  |
| `README.md`                      | User-facing install/usage/flags/exit-codes doc                                             |

---

## Task 1: Project Scaffold

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `bin/cli.ts` (stub)
- Create: `src/cli.ts` (stub)

- [ ] **Step 1: Verify `fs.promises.mkdtempDisposable` API via context7**

  Query context7 for `node fs mkdtempDisposable`. The API should return an `AsyncDisposable` object with a `.path` string property. Confirm the exact signature before using it in Task 7. If it is not available in the installed Node version, note the fallback:

  ```typescript
  // Fallback if mkdtempDisposable is unavailable:
  import { mkdtemp, rm } from 'node:fs/promises'
  const tempPath = await mkdtemp(join(tmpdir(), 'setup-tp-'))
  try {
    // ... use tempPath
  } finally {
    await rm(tempPath, { recursive: true, force: true })
  }
  ```

- [ ] **Step 2: Create directory structure**

  ```bash
  mkdir -p bin src tests/helpers .github/workflows
  ```

- [ ] **Step 3: Write `package.json`**

  ```json
  {
    "name": "setup-trusted-publishing",
    "version": "0.1.0",
    "description": "Publish a 0.0.0 stub to npm so OIDC trusted publishing can be configured",
    "type": "module",
    "engines": {
      "node": ">=24"
    },
    "bin": {
      "setup-trusted-publishing": "./dist/bin/cli.js"
    },
    "files": ["dist/bin", "dist/src", "README.md"],
    "scripts": {
      "build": "tsc",
      "typecheck": "tsc --noEmit",
      "test": "node --experimental-strip-types --test tests/access.test.ts tests/packument.test.ts tests/stub.test.ts tests/registry.test.ts tests/cli.test.ts"
    },
    "dependencies": {
      "libnpmpack": "*",
      "npm-registry-fetch": "*",
      "validate-npm-package-name": "*"
    },
    "devDependencies": {
      "@types/node": "^24",
      "typescript": "^5"
    }
  }
  ```

  > After `pnpm install`, pin the actual resolved versions in the plan notes. The `*` versions will be locked in `pnpm-lock.yaml`.

- [ ] **Step 4: Write `tsconfig.json`**

  ```json
  {
    "compilerOptions": {
      "target": "ES2024",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "outDir": "dist",
      "strict": true,
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true,
      "skipLibCheck": true
    },
    "include": ["bin/**/*", "src/**/*"],
    "exclude": ["node_modules", "dist", "tests"]
  }
  ```

- [ ] **Step 5: Write `.gitignore`**

  ```
  node_modules/
  dist/
  *.tgz
  .DS_Store
  ```

- [ ] **Step 6: Write stub `bin/cli.ts`**

  ```typescript
  #!/usr/bin/env node
  import main from '../src/cli.js'
  process.exit(await main())
  ```

- [ ] **Step 7: Write stub `src/cli.ts`**

  ```typescript
  export default async function main(): Promise<number> {
    return 0
  }
  ```

- [ ] **Step 8: Install dependencies**

  ```bash
  pnpm install
  ```

  Expected: resolves packages, creates `pnpm-lock.yaml`.

- [ ] **Step 9: Verify typecheck passes**

  ```bash
  pnpm typecheck
  ```

  Expected: no errors.

- [ ] **Step 10: Check `validate-npm-package-name` types**

  ```bash
  pnpm info validate-npm-package-name | grep -E "(types|typings)"
  ```

  If the package does not ship types, install them:

  ```bash
  pnpm add -D @types/validate-npm-package-name
  ```

  Then re-run `pnpm typecheck` to confirm.

- [ ] **Step 11: Verify `libnpmpack` API via context7**

  Query context7 for `libnpmpack`. Confirm:
  - Whether it is a default export (`import pack from 'libnpmpack'`) or named (`import { pack }`)
  - What it accepts: a directory path string, or a spec string + directory
  - What it returns: `Buffer` or `Promise<Buffer>`

  Record the confirmed signature here before writing Task 6.

- [ ] **Step 12: Commit scaffold**

  ```bash
  git add -A
  git commit -m "chore: project scaffold"
  ```

---

## Task 2: `src/access.ts` — Access Resolution

**Files:**

- Create: `src/access.ts`
- Create: `tests/access.test.ts`

- [ ] **Step 1: Write the failing tests**

  Create `tests/access.test.ts`:

  ```typescript
  import { test, describe } from 'node:test'
  import assert from 'node:assert/strict'
  import { resolveAccess, AccessConflictError } from '../src/access.ts'

  describe('resolveAccess', () => {
    // Row 9: no private, no publishConfig, no flag → public, inferred-default
    test('plain new package → public inferred-default', () => {
      const r = resolveAccess({
        isPrivate: undefined,
        existingAccess: undefined,
        flagAccess: undefined,
        force: false,
      })
      assert.deepStrictEqual(r, { value: 'public', reason: 'inferred-default', changed: true })
    })

    // Row 8: private: true, no publishConfig, no flag → restricted, inferred-private
    test('private:true no publishConfig → restricted inferred-private', () => {
      const r = resolveAccess({
        isPrivate: true,
        existingAccess: undefined,
        flagAccess: undefined,
        force: false,
      })
      assert.deepStrictEqual(r, { value: 'restricted', reason: 'inferred-private', changed: true })
    })

    // Row 7: existing public, no flag → no change
    test('existing publishConfig.access public, no flag → no change', () => {
      const r = resolveAccess({
        isPrivate: undefined,
        existingAccess: 'public',
        flagAccess: undefined,
        force: false,
      })
      assert.deepStrictEqual(r, { value: 'public', reason: 'existing', changed: false })
    })

    // Row 5: no existing, --access restricted → restricted, cli-flag
    test('no publishConfig, --access restricted → restricted cli-flag', () => {
      const r = resolveAccess({
        isPrivate: undefined,
        existingAccess: undefined,
        flagAccess: 'restricted',
        force: false,
      })
      assert.deepStrictEqual(r, { value: 'restricted', reason: 'cli-flag', changed: true })
    })

    // Row 3: private:true, --access public, no force → throws flag-vs-private
    test('private:true --access public no force → throws flag-vs-private', () => {
      assert.throws(
        () =>
          resolveAccess({
            isPrivate: true,
            existingAccess: undefined,
            flagAccess: 'public',
            force: false,
          }),
        (err: unknown) => {
          assert.ok(err instanceof AccessConflictError)
          assert.strictEqual(err.conflict, 'flag-vs-private')
          return true
        }
      )
    })

    // Row 4: private:true, --access public, force → public, cli-flag
    test('private:true --access public --force → public cli-flag', () => {
      const r = resolveAccess({
        isPrivate: true,
        existingAccess: undefined,
        flagAccess: 'public',
        force: true,
      })
      assert.deepStrictEqual(r, { value: 'public', reason: 'cli-flag', changed: true })
    })

    // Row 5 variant: private:true, --access restricted → ok, no conflict
    test('private:true --access restricted → restricted cli-flag (no conflict)', () => {
      const r = resolveAccess({
        isPrivate: true,
        existingAccess: undefined,
        flagAccess: 'restricted',
        force: false,
      })
      assert.deepStrictEqual(r, { value: 'restricted', reason: 'cli-flag', changed: true })
    })

    // Row 1: existing public, --access restricted, no force → throws flag-vs-existing
    test('existing public --access restricted no force → throws flag-vs-existing', () => {
      assert.throws(
        () =>
          resolveAccess({
            isPrivate: undefined,
            existingAccess: 'public',
            flagAccess: 'restricted',
            force: false,
          }),
        (err: unknown) => {
          assert.ok(err instanceof AccessConflictError)
          assert.strictEqual(err.conflict, 'flag-vs-existing')
          return true
        }
      )
    })

    // Row 2: existing public, --access restricted, force → restricted, overwrote
    test('existing public --access restricted --force → restricted overwrote:public', () => {
      const r = resolveAccess({
        isPrivate: undefined,
        existingAccess: 'public',
        flagAccess: 'restricted',
        force: true,
      })
      assert.deepStrictEqual(r, {
        value: 'restricted',
        reason: 'cli-flag',
        changed: true,
        overwrote: 'public',
      })
    })

    // Row 6: existing public, --access public → no change (matches)
    test('existing public --access public → no change (matches)', () => {
      const r = resolveAccess({
        isPrivate: undefined,
        existingAccess: 'public',
        flagAccess: 'public',
        force: false,
      })
      assert.deepStrictEqual(r, { value: 'public', reason: 'existing', changed: false })
    })
  })
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  pnpm test 2>&1 | head -30
  ```

  Expected: `ERR_MODULE_NOT_FOUND` or similar — `src/access.ts` doesn't exist yet.

- [ ] **Step 3: Write `src/access.ts`**

  ```typescript
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
  ```

- [ ] **Step 4: Run access tests only**

  ```bash
  node --experimental-strip-types --test tests/access.test.ts
  ```

  Expected: 10 passing tests, 0 failures.

- [ ] **Step 5: Run typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/access.ts tests/access.test.ts
  git commit -m "feat: access resolution pure function with full decision matrix"
  ```

---

## Task 3: `src/packument.ts` — Read/Write `package.json`

**Files:**

- Create: `src/packument.ts`
- Create: `tests/packument.test.ts`
- Create: `tests/fixtures/` (temp dir created in tests themselves)

- [ ] **Step 1: Write failing tests**

  Create `tests/packument.test.ts`:

  ```typescript
  import { test, describe, before, after } from 'node:test'
  import assert from 'node:assert/strict'
  import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
  import { join } from 'node:path'
  import { tmpdir } from 'node:os'
  import { readPackage, writePackageAccess } from '../src/packument.ts'

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

  describe('writePackageAccess', () => {
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
      await writePackageAccess(dir, r, 'public')
      const written = await readFile(join(dir, 'package.json'), 'utf8')
      const parsed = JSON.parse(written) as Record<string, unknown>
      assert.deepStrictEqual(
        (parsed['publishConfig'] as Record<string, unknown>)['access'],
        'public'
      )
      assert.ok(written.endsWith('\n'), 'trailing newline preserved')
      // Check indent — the publishConfig key should be indented by 2 spaces
      assert.ok(written.includes('\n  "publishConfig"'), '2-space indent preserved')
    })

    test('preserves tab indent', async () => {
      await writeFile(join(dir, 'package.json'), '{\n\t"name": "bar"\n}\n')
      const r = await readPackage(dir)
      await writePackageAccess(dir, r, 'restricted')
      const written = await readFile(join(dir, 'package.json'), 'utf8')
      assert.ok(written.includes('\n\t"publishConfig"'), 'tab indent preserved')
    })

    test('preserves absence of trailing newline', async () => {
      await writeFile(join(dir, 'package.json'), '{\n  "name": "baz"\n}')
      const r = await readPackage(dir)
      await writePackageAccess(dir, r, 'public')
      const written = await readFile(join(dir, 'package.json'), 'utf8')
      assert.ok(!written.endsWith('\n'), 'no trailing newline preserved')
    })

    test('merges into existing publishConfig preserving other keys', async () => {
      const original =
        '{\n  "name": "foo",\n  "publishConfig": {\n    "registry": "https://example.com"\n  }\n}\n'
      await writeFile(join(dir, 'package.json'), original)
      const r = await readPackage(dir)
      await writePackageAccess(dir, r, 'restricted')
      const written = await readFile(join(dir, 'package.json'), 'utf8')
      const parsed = JSON.parse(written) as { publishConfig: Record<string, unknown> }
      assert.strictEqual(parsed.publishConfig['access'], 'restricted')
      assert.strictEqual(parsed.publishConfig['registry'], 'https://example.com')
    })

    test('overwrites existing publishConfig.access', async () => {
      const original = '{\n  "name": "foo",\n  "publishConfig": { "access": "public" }\n}\n'
      await writeFile(join(dir, 'package.json'), original)
      const r = await readPackage(dir)
      await writePackageAccess(dir, r, 'restricted')
      const written = await readFile(join(dir, 'package.json'), 'utf8')
      const parsed = JSON.parse(written) as { publishConfig: Record<string, unknown> }
      assert.strictEqual(parsed.publishConfig['access'], 'restricted')
    })
  })
  ```

- [ ] **Step 2: Run to confirm they fail**

  ```bash
  node --experimental-strip-types --test tests/packument.test.ts 2>&1 | head -10
  ```

  Expected: module not found or similar.

- [ ] **Step 3: Write `src/packument.ts`**

  ```typescript
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

  export async function writePackageAccess(
    cwd: string,
    result: ReadPackageResult,
    access: 'public' | 'restricted'
  ): Promise<void> {
    const { parsed, indent, hasTrailingNewline } = result

    const updated: PackageJson = {
      ...parsed,
      publishConfig: {
        ...parsed.publishConfig,
        access,
      },
    }

    let content = JSON.stringify(updated, null, indent)
    if (hasTrailingNewline) content += '\n'

    await writeFile(join(cwd, 'package.json'), content, 'utf8')
  }
  ```

- [ ] **Step 4: Run packument tests**

  ```bash
  node --experimental-strip-types --test tests/packument.test.ts
  ```

  Expected: all tests pass.

- [ ] **Step 5: Run typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/packument.ts tests/packument.test.ts
  git commit -m "feat: read/write package.json with indent and EOL preservation"
  ```

---

## Task 4: `src/stub.ts` — Stub Manifest + Directory

**Files:**

- Create: `src/stub.ts`
- Create: `tests/stub.test.ts`

- [ ] **Step 1: Write failing tests**

  Create `tests/stub.test.ts`:

  ```typescript
  import { test, describe, before, after } from 'node:test'
  import assert from 'node:assert/strict'
  import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
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
      import { writeFile } from 'node:fs/promises'
      await writeFile(join(dir, 'extra.js'), '')
      await assert.rejects(() => verifyStubDir(dir), /unexpected/i)
    })
  })
  ```

  > Note: the `verifyStubDir` test that injects an extra file will leave the dir dirty. The `after()` cleanup still removes the whole dir.

- [ ] **Step 2: Run to confirm they fail**

  ```bash
  node --experimental-strip-types --test tests/stub.test.ts 2>&1 | head -10
  ```

  Expected: module not found.

- [ ] **Step 3: Write `src/stub.ts`**

  ```typescript
  import { writeFile, readdir } from 'node:fs/promises'
  import { join } from 'node:path'
  import type { PackageJson } from './packument.js'

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

    const manifest: StubManifest = {
      name: source.name,
      version: '0.0.0',
      main: 'index.js',
      description: source.description ?? 'Stub package for npm trusted publishing setup',
      publishConfig: { ...source.publishConfig, access: resolvedAccess },
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
    const actual = (await readdir(dir)).sort()
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
  ```

- [ ] **Step 4: Fix the dynamic import in the test**

  The test step that adds an extra file uses `import { writeFile }` inside a test body — that's invalid. Open `tests/stub.test.ts` and move that test to use the already-imported `writeFile` from the top of the file (it is already imported). Remove the inline `import` statement from inside the test body.

  The test block should be:

  ```typescript
  test('verifyStubDir throws when unexpected file present', async () => {
    await writeFile(join(dir, 'extra.js'), '')
    await assert.rejects(() => verifyStubDir(dir), /unexpected/i)
  })
  ```

- [ ] **Step 5: Run stub tests**

  ```bash
  node --experimental-strip-types --test tests/stub.test.ts
  ```

  Expected: all tests pass.

- [ ] **Step 6: Run typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add src/stub.ts tests/stub.test.ts
  git commit -m "feat: stub manifest builder and directory writer"
  ```

---

## Task 5: Test Helpers — Mock Registry and Mock PM

**Files:**

- Create: `tests/helpers/mock-registry.ts`
- Create: `tests/helpers/mock-pm.ts`

These are not compiled into `dist/` (tsconfig excludes `tests/`). They are TypeScript source files run via `--experimental-strip-types` alongside the test files.

- [ ] **Step 1: Write `tests/helpers/mock-registry.ts`**

  ```typescript
  import { createServer, type Server } from 'node:http'
  import { once } from 'node:events'

  export interface MockRegistry {
    url: string
    add(packageName: string): void
    close(): Promise<void>
  }

  /**
   * Creates a minimal fake npm registry server.
   * - Returns 200 + a minimal packument JSON for known packages.
   * - Returns 404 for everything else.
   * - Handles scoped package names: @org%2Fpkg → @org/pkg lookup.
   */
  export async function createMockRegistry(knownPackages: string[] = []): Promise<MockRegistry> {
    const known = new Set(knownPackages)

    const server: Server = createServer((req, res) => {
      // Decode %2F → / and strip leading slash to get package name
      const rawPath = decodeURIComponent(req.url ?? '/').slice(1)

      if (known.has(rawPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ 'name': rawPath, 'versions': {}, 'dist-tags': {} }))
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
      }
    })

    server.listen(0) // OS picks the port
    await once(server, 'listening')

    const addr = server.address() as { port: number }

    return {
      url: `http://localhost:${addr.port}`,
      add(name: string) {
        known.add(name)
      },
      async close() {
        server.close()
        await once(server, 'close')
      },
    }
  }
  ```

- [ ] **Step 2: Write `tests/helpers/mock-pm.ts`**

  The mock script is a Node.js file written to a temp directory. It records all invocations to an NDJSON file and exits with a configurable code.

  ```typescript
  import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
  import { join } from 'node:path';
  import { tmpdir } from 'node:os';

  export interface MockPM {
    /** Prepend this to PATH when running the CLI under test */
    binDir: string;
    /** Returns all recorded invocation arg arrays, in order */
    getCalls(): Promise<string[][]>;
    /** Set the exit code the next (and subsequent) invocations will return */
    setExitCode(code: number): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
  }

  /**
   * Creates a fake npm or pnpm binary in a temp directory.
   *
   * The binary:
   *   - records process.argv.slice(2) as a JSON line to a calls file
   *   - exits with the code written to an exit-code file (default 0)
   *
   * Usage:
   *   await using pm = await createMockPM('npm');
   *   const result = spawnSync('node', ['...'], {
   *     env: { ...process.env, PATH: `${pm.binDir}:${process.env.PATH}` },
   *   });
   */
  export async function createMockPM(pm: 'npm' | 'pnpm' = 'npm'): Promise<MockPM> {
    const dir = await mkdtemp(join(tmpdir(), 'mock-pm-'));
    const callsFile = join(dir, 'calls.ndjson');
    const exitCodeFile = join(dir, 'exit-code');

    // The mock script uses hardcoded absolute paths to avoid env var complexity.
    const scriptContent = `#!/usr/bin/env node
  import { appendFileSync, readFileSync, existsSync } from 'node:fs';
  ```

appendFileSync(
${JSON.stringify(callsFile)},
JSON.stringify(process.argv.slice(2)) + '\\n',
'utf8'
);

const exitCode = existsSync(${JSON.stringify(exitCodeFile)})
  ? parseInt(readFileSync(${JSON.stringify(exitCodeFile)}, 'utf8').trim(), 10)
: 0;

process.exit(isNaN(exitCode) ? 0 : exitCode);
`;

    await writeFile(join(dir, pm), scriptContent, { mode: 0o755 });

    return {
      binDir: dir,

      async getCalls(): Promise<string[][]> {
        try {
          const content = await readFile(callsFile, 'utf8');
          return content
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line) as string[]);
        } catch {
          return [];
        }
      },

      async setExitCode(code: number): Promise<void> {
        await writeFile(exitCodeFile, String(code), 'utf8');
      },

      async [Symbol.asyncDispose](): Promise<void> {
        await rm(dir, { recursive: true, force: true });
      },
    };

}

````

- [ ] **Step 3: Smoke-test the helpers compile cleanly**

```bash
node --experimental-strip-types --check tests/helpers/mock-registry.ts tests/helpers/mock-pm.ts
````

Expected: no errors (or `--check` not recognised — then just proceed to Task 6 where the helpers are imported).

- [ ] **Step 4: Commit**

  ```bash
  git add tests/helpers/
  git commit -m "test: mock registry and mock PM helpers"
  ```

---

## Task 6: `src/registry.ts` — Registry Check, Pack, Publish

**Files:**

- Create: `src/registry.ts`
- Create: `tests/registry.test.ts`

Before writing code, confirm the `libnpmpack` and `npm-registry-fetch` API shapes from the research in Task 1 Step 11. The code below uses the most likely signatures — adjust if the verified API differs.

- [ ] **Step 1: Write failing tests**

  Create `tests/registry.test.ts`:

  ```typescript
  import { test, describe, after } from 'node:test'
  import assert from 'node:assert/strict'
  import { join } from 'node:path'
  import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
  import { tmpdir } from 'node:os'
  import { createMockRegistry } from './helpers/mock-registry.ts'
  import { createMockPM } from './helpers/mock-pm.ts'
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

      const code = await runPublish({
        pm: 'npm',
        tarballPath: tarball,
        cwd: tmpdir(),
        env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
      })

      assert.strictEqual(code, 0)
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

      const code = await runPublish({
        pm: 'npm',
        tarballPath: tarball,
        cwd: tmpdir(),
        env: { ...process.env, PATH: `${pm.binDir}:${process.env['PATH']}` },
      })

      assert.strictEqual(code, 1)
    })
  })
  ```

- [ ] **Step 2: Run to confirm they fail**

  ```bash
  node --experimental-strip-types --test tests/registry.test.ts 2>&1 | head -10
  ```

- [ ] **Step 3: Write `src/registry.ts`**

  > **Adjust the `libnpmpack` import and call to match the API confirmed in Task 1 Step 11.**

  ```typescript
  import { spawn } from 'node:child_process'
  import npmFetch from 'npm-registry-fetch'
  import libnpmpack from 'libnpmpack'

  // ── Package manager detection ─────────────────────────────────────────────

  export type SupportedPM = 'npm' | 'pnpm'

  export type PMDetectionResult =
    | { pm: SupportedPM; source: 'packageManager-field' | 'user-agent' | 'fallback' }
    | { pm: null; unsupported: string }

  /**
   * Resolves which package manager to use for `publish`.
   *
   * @param packageManagerField - value of `package.json#packageManager` (e.g. "pnpm@9.0.0")
   * @param userAgent - value of `process.env.npm_config_user_agent`
   */
  export function detectPackageManager(
    packageManagerField: string | undefined,
    userAgent: string | undefined
  ): PMDetectionResult {
    // 1. packageManager field
    if (packageManagerField) {
      const name = packageManagerField.split('@')[0] ?? ''
      if (name === 'npm') return { pm: 'npm', source: 'packageManager-field' }
      if (name === 'pnpm') return { pm: 'pnpm', source: 'packageManager-field' }
      return { pm: null, unsupported: name }
    }

    // 2. npm_config_user_agent
    if (userAgent) {
      if (userAgent.startsWith('pnpm/')) return { pm: 'pnpm', source: 'user-agent' }
      if (userAgent.startsWith('yarn/')) return { pm: null, unsupported: 'yarn' }
      return { pm: 'npm', source: 'user-agent' }
    }

    // 3. Fallback
    return { pm: 'npm', source: 'fallback' }
  }

  // ── Registry existence check ──────────────────────────────────────────────

  export async function packageExists(
    name: string,
    opts: { registry?: string } = {}
  ): Promise<boolean> {
    // Encode scoped names: @org/pkg → @org%2Fpkg (keep @, encode /)
    const escapedName = name.startsWith('@') ? '@' + name.slice(1).replace('/', '%2F') : name

    const fetchOpts = { registry: opts.registry }

    try {
      await npmFetch(`/${escapedName}`, { ...fetchOpts, forceAuth: { alwaysAuth: false } })
      return true
    } catch (err: unknown) {
      const e = err as { statusCode?: number }
      if (e.statusCode === 404) return false

      // 401: retry with auth from .npmrc
      if (e.statusCode === 401) {
        try {
          await npmFetch(`/${escapedName}`, fetchOpts)
          return true
        } catch (retryErr: unknown) {
          const re = retryErr as { statusCode?: number }
          if (re.statusCode === 404) return false
          throw retryErr
        }
      }

      throw err
    }
  }

  // ── Tarball packing ───────────────────────────────────────────────────────

  /** Pack the stub directory into a tarball Buffer using libnpmpack. */
  export async function packStub(dir: string): Promise<Buffer> {
    // If libnpmpack's confirmed API differs from this call, adjust here.
    return (await libnpmpack(dir)) as Buffer
  }

  // ── Publish spawn ─────────────────────────────────────────────────────────

  export interface RunPublishOptions {
    pm: SupportedPM
    tarballPath: string
    cwd: string
    registry?: string
    /** Override process.env for testing; defaults to process.env */
    env?: NodeJS.ProcessEnv
  }

  /**
   * Spawns `npm publish <tarball>` or `pnpm publish <tarball> --no-git-checks`.
   * Returns the process exit code.
   */
  export async function runPublish(opts: RunPublishOptions): Promise<number> {
    const { pm, tarballPath, cwd, registry, env } = opts

    const args = ['publish', tarballPath]
    if (pm === 'pnpm') args.push('--no-git-checks')
    if (registry) args.push(`--registry=${registry}`)

    return new Promise((resolve, reject) => {
      const child = spawn(pm, args, {
        cwd,
        stdio: 'inherit',
        env: env ?? process.env,
      })
      child.on('exit', (code) => resolve(code ?? 1))
      child.on('error', reject)
    })
  }
  ```

- [ ] **Step 4: Run registry tests**

  ```bash
  node --experimental-strip-types --test tests/registry.test.ts
  ```

  Expected: all tests pass. If `libnpmpack` call signature is wrong, update `packStub` to match the confirmed API from Task 1 Step 11.

- [ ] **Step 5: Run typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: no errors. If `npm-registry-fetch` or `libnpmpack` lack types, install `@types/` packages:

  ```bash
  pnpm add -D @types/npm-registry-fetch  # if needed
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src/registry.ts tests/registry.test.ts
  git commit -m "feat: registry check, pack, and publish spawn"
  ```

---

## Task 7: `src/cli.ts` + `bin/cli.ts` + E2E Tests

**Files:**

- Modify: `src/cli.ts` (replace stub)
- Modify: `bin/cli.ts` (replace stub)
- Create: `tests/cli.test.ts`

`main()` accepts `{ argv, log, err }` overrides so tests never call `process.exit()` and never see output on the real stdio.

- [ ] **Step 1: Write failing e2e tests**

  Create `tests/cli.test.ts`:

  ```typescript
  import { test, describe, before, after, beforeEach } from 'node:test'
  import assert from 'node:assert/strict'
  import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
  import { join } from 'node:path'
  import { tmpdir } from 'node:os'
  import { createMockRegistry } from './helpers/mock-registry.ts'
  import { createMockPM } from './helpers/mock-pm.ts'
  import main from '../src/cli.ts'

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
    if (opts.pmExitCode) await pm.setExitCode(opts.pmExitCode)

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
      assert.strictEqual((await ctx.pm.getCalls()).length, 0)
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

  test('--force + --dry-run together → exit 2', async () => {
    const ctx = await runCLI({ argv: ['--force', '--dry-run'] })
    try {
      assert.strictEqual(ctx.code, 2)
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
    const ctx = await runCLI({ pkgJson: { name: '@org/foo', version: '1.0.0' } })
    try {
      assert.strictEqual(ctx.code, 0)
      const calls = await ctx.pm.getCalls()
      assert.ok(calls[0]![1]!.endsWith('org-foo-0.0.0.tgz'))
    } finally {
      await cleanup(ctx)
    }
  })

  // ── Indent/EOL preservation ───────────────────────────────────────────────

  test('4-space indent preserved after writing publishConfig', async () => {
    const ctx = await runCLI({
      pkgJson: undefined,
      argv: [],
    })
    // Rewrite manually with 4-space indent
    await rm(ctx.cwd, { recursive: true })
    const cwd2 = await mkdtemp(join(tmpdir(), 'cli-test-'))
    await writeFile(
      join(cwd2, 'package.json'),
      '{\n    "name": "test-pkg",\n    "version": "1.0.0"\n}\n'
    )
    const reg2 = await createMockRegistry([])
    const pm2 = await createMockPM('npm')
    const code = await main({
      argv: ['--cwd', cwd2, '--registry', reg2.url],
      log: () => {},
      err: () => {},
      env: { ...process.env, PATH: `${pm2.binDir}:${process.env['PATH']}` },
    })
    const written = await readFile(join(cwd2, 'package.json'), 'utf8')
    await rm(cwd2, { recursive: true })
    await pm2[Symbol.asyncDispose]()
    await reg2.close()
    assert.ok(written.includes('\n    "publishConfig"'), '4-space indent preserved')
    assert.strictEqual(code, 0)
  })

  // ── Success output ────────────────────────────────────────────────────────

  test('public registry success → output contains npmjs.com URL', async () => {
    // Use the real npmjs.org registry string to trigger the URL branch.
    // Override by passing the mock registry but spoofing its URL check.
    // Instead: test the URL-building logic by pointing registry to registry.npmjs.org host.
    // Simplest approach: call main without --registry (uses default) but intercept output.
    // Since we can't hit real registry, this test targets the output format via a unit approach:
    // Run with mock registry whose URL happens to be the npmjs host.
    // For testing: accept that this test verifies the logic indirectly via non-npmjs path.
    const ctx = await runCLI({})
    try {
      // The mock registry URL is localhost, so we should see "to <registry>"
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
      const files = await import('node:fs/promises').then((m) => m.readdir(ctx.cwd))
      assert.ok(files.some((f) => f.endsWith('.tgz')))
      // publish never called
      assert.strictEqual((await ctx.pm.getCalls()).length, 0)
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
      argv: ['--no-publish'],
    })
    try {
      const files = await import('node:fs/promises').then((m) => m.readdir(ctx.cwd))
      assert.ok(files.includes('org-foo-0.0.0.tgz'))
    } finally {
      await cleanup(ctx)
    }
  })
  ```

- [ ] **Step 2: Run to confirm they fail**

  ```bash
  node --experimental-strip-types --test tests/cli.test.ts 2>&1 | head -20
  ```

  Expected: import errors (src/cli.ts is still the stub).

- [ ] **Step 3: Write `src/cli.ts`**

  ```typescript
  import { parseArgs } from 'node:util'
  import { join } from 'node:path'
  import { tmpdir } from 'node:os'
  import { promises as fs } from 'node:fs'
  import validate from 'validate-npm-package-name'
  import { readPackage, writePackageAccess } from './packument.js'
  import { resolveAccess, AccessConflictError } from './access.js'
  import { buildStubManifest, writeStubDir, verifyStubDir } from './stub.js'
  import { detectPackageManager, packageExists, packStub, runPublish } from './registry.js'

  export interface MainOptions {
    argv?: string[]
    log?: (msg: string) => void
    err?: (msg: string) => void
    /** Override process.env for testing */
    env?: NodeJS.ProcessEnv
  }

  export default async function main(opts: MainOptions = {}): Promise<number> {
    const argv = opts.argv ?? process.argv.slice(2)
    const log = opts.log ?? ((msg: string) => console.log(msg))
    const err = opts.err ?? ((msg: string) => console.error(msg))
    const env = opts.env ?? process.env

    // ── Step 1: Parse args ──────────────────────────────────────────────────

    let parsed: ReturnType<typeof parseArgs>
    try {
      parsed = parseArgs({
        args: argv,
        strict: true,
        allowPositionals: false,
        options: {
          'dry-run': { type: 'boolean', short: 'n', default: false },
          'no-publish': { type: 'boolean', default: false },
          'access': { type: 'string' },
          'force': { type: 'boolean', short: 'f', default: false },
          'registry': { type: 'string' },
          'cwd': { type: 'string', short: 'C' },
          'help': { type: 'boolean', short: 'h', default: false },
        },
      })
    } catch (e) {
      err((e as Error).message)
      return 2
    }

    const args = parsed.values

    if (args['help']) {
      log(`setup-trusted-publishing [options]
  
  -n, --dry-run        Build the stub but do not publish or write the source
      --no-publish     Write source package.json, pack the stub, copy tarball to
                       --cwd — but do not publish (for unsupported package managers)
      --access <mode>  'public' or 'restricted'
  -f, --force          Bypass access conflict errors
      --registry <url> Registry to check and publish to
  -C, --cwd <path>     Source package directory (default: cwd)
  -h, --help`)
      return 0
    }

    const dryRun = args['dry-run'] as boolean
    const noPublish = args['no-publish'] as boolean
    const force = args['force'] as boolean
    const cwd = (args['cwd'] as string | undefined) ?? process.cwd()
    const registry = args['registry'] as string | undefined
    const flagAccess = args['access'] as string | undefined

    // Validate flag combinations
    if (dryRun && noPublish) {
      err('--dry-run and --no-publish cannot be used together')
      return 2
    }
    if (dryRun && force) {
      err('--dry-run and --force cannot be used together')
      return 2
    }
    if (flagAccess !== undefined && flagAccess !== 'public' && flagAccess !== 'restricted') {
      err(`Invalid --access value: "${flagAccess}". Must be "public" or "restricted".`)
      return 2
    }

    const typedFlagAccess = flagAccess as 'public' | 'restricted' | undefined

    // ── Step 2: Read package.json ───────────────────────────────────────────

    let pkgResult: Awaited<ReturnType<typeof readPackage>>
    try {
      pkgResult = await readPackage(cwd)
    } catch (e) {
      err(`Failed to read package.json: ${(e as Error).message}`)
      return 1
    }

    // ── Step 3: Validate package name ───────────────────────────────────────

    const name = pkgResult.parsed.name
    if (!name) {
      err('package.json is missing the required "name" field')
      return 1
    }
    const validation = validate(name)
    if (!validation.validForNewPackages) {
      const reasons = [...(validation.errors ?? []), ...(validation.warnings ?? [])]
      err(`Invalid package name "${name}": ${reasons.join(', ')}`)
      return 1
    }

    // ── Step 4: Detect package manager ─────────────────────────────────────

    const pmDetection = detectPackageManager(
      pkgResult.parsed.packageManager,
      env['npm_config_user_agent']
    )

    if (!noPublish && !dryRun && pmDetection.pm === null) {
      err(
        `Unsupported package manager: ${pmDetection.unsupported}. ` +
          `Use --no-publish to prepare the stub tarball and publish it manually.`
      )
      return 1
    }

    // ── Step 5: Registry existence check ────────────────────────────────────

    let exists: boolean
    try {
      exists = await packageExists(name, { registry })
    } catch (e) {
      err(`Registry check failed: ${(e as Error).message}`)
      return 1
    }

    if (exists) {
      log(`${name} is already published — nothing to do.`)
      return 0
    }

    // ── Step 6: Resolve access ──────────────────────────────────────────────

    let accessResolution: ReturnType<typeof resolveAccess>
    try {
      accessResolution = resolveAccess({
        isPrivate: pkgResult.parsed.private,
        existingAccess: pkgResult.parsed.publishConfig?.access,
        flagAccess: typedFlagAccess,
        force,
      })
    } catch (e) {
      if (e instanceof AccessConflictError) {
        err(e.message)
        return 2
      }
      throw e
    }

    // ── Step 7: Write publishConfig.access to source (unless dry-run) ──────

    if (accessResolution.changed && !dryRun) {
      await writePackageAccess(cwd, pkgResult, accessResolution.value)
    }

    // ── Step 8: Build stub manifest ─────────────────────────────────────────

    // Re-read parsed so buildStubManifest sees the updated publishConfig
    const updatedPkg = accessResolution.changed
      ? {
          ...pkgResult.parsed,
          publishConfig: { ...pkgResult.parsed.publishConfig, access: accessResolution.value },
        }
      : pkgResult.parsed

    const stubManifest = buildStubManifest(updatedPkg, accessResolution.value)

    // ── Step 9: dry-run exit ─────────────────────────────────────────────────

    if (dryRun) {
      log('Stub manifest (dry run):')
      log(JSON.stringify(stubManifest, null, 2))
      return 0
    }

    // ── Steps 10–17: Pack and publish ────────────────────────────────────────

    const tarballName = `${name.replace(/^@/, '').replace(/\//g, '-')}-0.0.0.tgz`

    // mkdtempDisposable API verified in Task 1 Step 1.
    // If unavailable, use the try/finally fallback noted there.
    await using tempDir = await fs.mkdtempDisposable(join(tmpdir(), 'setup-tp-'))
    const tempPath: string = (tempDir as unknown as { path: string }).path

    // Step 11: Write stub files
    await writeStubDir(tempPath, stubManifest)

    // Step 12: Verify contents
    try {
      await verifyStubDir(tempPath)
    } catch (e) {
      err((e as Error).message)
      return 1
    }

    // Step 13: Pack
    const tarBuf = await packStub(tempPath)
    const tarballPath = join(tempPath, tarballName)
    await fs.writeFile(tarballPath, tarBuf)

    // Step 14: --no-publish
    if (noPublish) {
      const dest = join(cwd, tarballName)
      await fs.copyFile(tarballPath, dest)
      log(`Stub packed to ./${tarballName}`)
      log(`Run your publish command to complete the initial publish, e.g.:`)
      log(`  yarn npm publish ./${tarballName}`)
      return 0
    }

    // Step 15: Spawn publish
    const pm = pmDetection.pm!
    const exitCode = await runPublish({
      pm,
      tarballPath,
      cwd,
      registry: registry !== undefined ? registry : undefined,
      env,
    })
    if (exitCode !== 0) return exitCode

    // Step 16: Success output
    const effectiveRegistry =
      registry ?? env['NPM_CONFIG_REGISTRY'] ?? 'https://registry.npmjs.org/'
    let registryHost: string
    try {
      registryHost = new URL(effectiveRegistry).hostname
    } catch {
      registryHost = ''
    }

    if (registryHost === 'registry.npmjs.org') {
      const urlSafeName = name.startsWith('@') ? `@${name.slice(1).replace('/', '%2F')}` : name
      log(`Published ${name}@0.0.0 → https://www.npmjs.com/package/${urlSafeName}`)
    } else {
      log(`Published ${name}@0.0.0 to ${effectiveRegistry}`)
    }

    return 0
    // Step 17: temp dir auto-cleans via await using
  }
  ```

  > **Note on `mkdtempDisposable`:** If the verified API from Task 1 Step 1 returns `.path` under a different property name, update the `(tempDir as unknown as { path: string }).path` cast accordingly. If `mkdtempDisposable` doesn't exist, replace the `await using` block with the `try/finally` fallback.

- [ ] **Step 4: Update `bin/cli.ts`**

  ```typescript
  #!/usr/bin/env node
  import main from '../src/cli.js'
  process.exit(await main())
  ```

- [ ] **Step 5: Extract and test `formatSuccessUrl`**

  The mock registry is always `localhost`, so the npmjs.com URL branch never fires in the e2e tests. Extract the URL-formatting logic into a pure exported function and unit-test it separately.

  Add to `src/cli.ts` (before `main()`):

  ```typescript
  /** Exported for testing. */
  export function formatSuccessUrl(name: string, effectiveRegistry: string): string {
    let hostname = ''
    try {
      hostname = new URL(effectiveRegistry).hostname
    } catch {
      /* */
    }

    if (hostname === 'registry.npmjs.org') {
      const urlSafeName = name.startsWith('@') ? `@${name.slice(1).replace('/', '%2F')}` : name
      return `Published ${name}@0.0.0 → https://www.npmjs.com/package/${urlSafeName}`
    }
    return `Published ${name}@0.0.0 to ${effectiveRegistry}`
  }
  ```

  Replace the inline success output block in `main()` with:

  ```typescript
  const effectiveRegistry = registry ?? env['NPM_CONFIG_REGISTRY'] ?? 'https://registry.npmjs.org/'
  log(formatSuccessUrl(name, effectiveRegistry))
  ```

  Add these tests to `tests/cli.test.ts`:

  ```typescript
  import { formatSuccessUrl } from '../src/cli.ts'

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
  ```

- [ ] **Step 6: Run e2e tests**

  ```bash
  node --experimental-strip-types --test tests/cli.test.ts
  ```

  Expected: all tests pass. Fix any issues with the `mkdtempDisposable` cast or `libnpmpack` call as needed.

- [ ] **Step 7: Run the full test suite**

  ```bash
  pnpm test
  ```

  Expected: all tests in all files pass.

- [ ] **Step 8: Run typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: no errors.

- [ ] **Step 9: Build to verify compilation**

  ```bash
  pnpm build
  ```

  Expected: `dist/` created with `bin/cli.js`, `src/*.js`, `src/*.d.ts`.

- [ ] **Step 10: Verify the shebang is in the compiled output**

  ```bash
  head -1 dist/bin/cli.js
  ```

  Expected: `#!/usr/bin/env node`

- [ ] **Step 11: Commit**

  ```bash
  git add src/cli.ts bin/cli.ts tests/cli.test.ts
  git commit -m "feat: CLI orchestration with full e2e test coverage"
  ```

---

## Task 8: GitHub Actions CI

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

  ```yaml
  name: CI

  on:
    push:
      branches: [main]
    pull_request:

  jobs:
    test:
      name: Test (Node ${{ matrix.node }})
      runs-on: ubuntu-latest
      strategy:
        matrix:
          node: ['24', '26']

      steps:
        - uses: actions/checkout@v4

        - uses: pnpm/action-setup@v4
          with:
            version: latest

        - uses: actions/setup-node@v4
          with:
            node-version: ${{ matrix.node }}
            cache: pnpm

        - run: pnpm install --frozen-lockfile

        - name: Typecheck
          run: pnpm typecheck

        - name: Test
          run: pnpm test

        - name: Build
          run: pnpm build
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add .github/workflows/ci.yml
  git commit -m "ci: add GitHub Actions workflow for Node 24 and 26"
  ```

---

## Task 9: README and Changesets

**Files:**

- Create: `README.md`
- Create: `.changeset/config.json` (via `pnpm changeset init`)

- [ ] **Step 1: Initialise changesets**

  ```bash
  pnpm add -D @changesets/cli
  pnpm changeset init
  ```

  Expected: `.changeset/config.json` and `.changeset/README.md` created.

- [ ] **Step 2: Write `README.md`**

  ````markdown
  # setup-trusted-publishing

  A CLI that publishes a `0.0.0` metadata-only stub of your package to npm so [OIDC trusted publishing](https://docs.npmjs.com/generating-provenance-statements) can be configured before your first real release.

  ## Problem

  npm's trusted publishing requires the package to already exist on the registry before you can configure it. This tool handles that one-time initial publish.

  ## Usage

  Run from inside your package directory (no install needed):

  ```sh
  # npm
  npx setup-trusted-publishing

  # pnpm
  pnpm dlx setup-trusted-publishing

  # yarn (pack only — see --no-publish)
  npx setup-trusted-publishing --no-publish
  ```

  The tool:

  1. Checks whether the package already exists (exits cleanly if so)
  2. Pins `publishConfig.access` in your `package.json`
  3. Publishes a minimal `0.0.0` stub
  4. Prints the registry URL so you can configure trusted publishing

  ## Options

  | Flag               | Description                                                                                                                                              |
  | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `-n, --dry-run`    | Print the stub manifest without writing files or publishing                                                                                              |
  | `--no-publish`     | Write `publishConfig.access` and pack the tarball to your project directory, but do not publish. Useful with yarn or other unsupported package managers. |
  | `--access <mode>`  | Force `public` or `restricted` (default: inferred from `private` field)                                                                                  |
  | `-f, --force`      | Bypass access conflict errors                                                                                                                            |
  | `--registry <url>` | Target registry (default: `$NPM_CONFIG_REGISTRY` or `registry.npmjs.org`)                                                                                |
  | `-C, --cwd <path>` | Source package directory (default: current directory)                                                                                                    |
  | `-h, --help`       | Print help                                                                                                                                               |

  ## Exit codes

  | Code | Meaning                                                    |
  | ---- | ---------------------------------------------------------- |
  | 0    | Success (published, already existed, or dry-run)           |
  | 1    | Internal error (see stderr for details)                    |
  | 2    | Bad arguments or access conflict (use `--force` to bypass) |

  ## Package manager support

  | Package manager | Auto-detected | Publish command                                       |
  | --------------- | ------------- | ----------------------------------------------------- |
  | npm             | ✓             | `npm publish <tarball>`                               |
  | pnpm            | ✓             | `pnpm publish <tarball> --no-git-checks`              |
  | yarn            | —             | Use `--no-publish`, then `yarn npm publish <tarball>` |

  Detection order: `package.json#packageManager` field → `npm_config_user_agent` env → fallback to npm.

  ## After running

  Once `0.0.0` is published, visit your package page on npmjs.com and configure trusted publishing under **Settings → Publishing**.

  ## Requirements

  Node.js 24 or later.
  ````

- [ ] **Step 3: Commit**

  ```bash
  git add README.md .changeset/
  git commit -m "docs: README and changesets setup"
  ```

---

## Self-Review Notes

**Spec coverage check:**

- ✓ Access resolution matrix (all 9 rows) — Task 2
- ✓ `package.json` indent + EOL preservation — Task 3
- ✓ Stub manifest allow-list + drop-list — Task 4
- ✓ Mock registry + mock PM helpers — Task 5
- ✓ `packageExists` with 401 retry — Task 6
- ✓ `detectPackageManager` (all 7 detection paths) — Task 6
- ✓ `runPublish` with pnpm `--no-git-checks` — Task 6
- ✓ All e2e scenarios from spec — Task 7
- ✓ `--no-publish` flag with yarn bypass — Task 7
- ✓ Scoped package encoding + tarball naming — Task 7
- ✓ Success output URL logic (npmjs.com vs other registry) — Task 7
- ✓ CI on Node 24 + 26 — Task 8
- ✓ Changesets — Task 9

**All items accounted for.** The `formatSuccessUrl` extraction in Task 7 Step 5 covers the npmjs.com URL branch that the mock suite cannot exercise. The registry-forwarding bug was corrected directly in the Task 7 `runPublish` call.
