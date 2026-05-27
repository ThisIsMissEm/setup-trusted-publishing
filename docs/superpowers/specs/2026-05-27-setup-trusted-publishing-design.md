# Design: setup-trusted-publishing

**Date:** 2026-05-27  
**Status:** Approved

---

## Problem

npm's OIDC trusted publishing (and the stage-only trusted-publisher flow) requires a package to already exist on the registry before it can be configured. Brand-new packages have a chicken-and-egg: they need an initial publish before the secure publish flow they actually want can be set up.

This tool handles that initial publish with a minimal stub. Run once per package, then configure trusted publishing on npmjs.com and let CI take over all real publishes.

---

## Scope

**In scope:**
- One CLI binary — `pnpm dlx setup-trusted-publishing` (or `npx`, globally installed)
- Read the current `package.json`, build a `0.0.0` stub with only basic metadata, publish it
- If the package already exists on the registry → exit 0, do nothing, touch no files
- Pin `publishConfig.access` on the source `package.json` so future CI publishes don't need `--access` flags
- Print the package URL on success so the user can click through to configure trusted publishing

**Out of scope:** re-publishes, version bumps, unpublishing, anything beyond the first publish.

---

## Target Stack

- **TypeScript**, ESM (`"type": "module"`)
- **Node.js 24+** — uses `fs.promises.mkdtempDisposable` + `await using`, `util.parseArgs`, top-level await
- No bundler — compile with `tsc`, ship `dist/`
- Changesets for release tooling

---

## Architecture

Multi-file, each module with a single clear purpose and independently testable:

```
bin/
  cli.ts            Shebang entrypoint — imports and calls src/cli.ts default export
src/
  cli.ts            parseArgs, orchestration, exit codes (only file touching process.*)
  access.ts         Access resolution pure function + AccessConflictError
  packument.ts      Read/write package.json with indent + EOL preservation
  stub.ts           Build stub manifest, write stub dir, verify contents
  registry.ts       packageExists (npm-registry-fetch), packStub (libnpmpack), runPublish (spawn)
tests/
  access.test.ts
  packument.test.ts
  stub.test.ts
  registry.test.ts
  cli.test.ts
  helpers/
    mock-registry.ts    http.createServer returning 200/404
    mock-npm.ts         Fake npm/pnpm binary on a temp PATH (test use only, not shipped)
```

---

## Dependencies

### Runtime

| Package | Purpose |
|---------|---------|
| `npm-registry-fetch` | Registry existence check. Handles scope-slash encoding, proxies, CA config, registry URL resolution. Throws with `err.statusCode === 404` for not-found. |
| `libnpmpack` | In-memory tarball creation — same code `npm pack` runs. Returns a Buffer. |
| `validate-npm-package-name` | Fast upfront name validation before any I/O. |

### Not used

- `libnpmpublish` — shell-out to `npm`/`pnpm` handles auth, OTP, provenance, proxies, `.npmrc` resolution, `NPM_CONFIG_*` env vars for free
- `npm-packlist` — plain `readdir` is sufficient; we control the temp dir we built
- `tar` — same reason; verify against the source dir, not the tarball

---

## CLI

```
setup-trusted-publishing [options]

  -n, --dry-run        Build the stub but do not publish or write the source
      --no-publish     Write source package.json, pack the stub, and place the
                       tarball in --cwd — but do not publish. For use with
                       unsupported package managers (e.g. yarn).
      --access <mode>  'public' or 'restricted'
  -f, --force          Bypass access conflict errors
      --registry <url> Registry to check and publish to
                       (default: $NPM_CONFIG_REGISTRY or registry.npmjs.org)
  -C, --cwd <path>     Source package directory (default: cwd)
  -h, --help
```

- `util.parseArgs` with `strict: true`, `allowPositionals: false`. Unknown args → exit 2.
- `--force` + `--dry-run` together → exit 2 (they conflict).
- `--no-publish` + `--dry-run` together → exit 2 (they conflict).

---

## Execution Flow

1. Parse and validate args. Invalid args → exit 2.
2. Read `package.json` from `--cwd`. Cache raw text, parsed object, detected indent, trailing-newline presence.
3. Validate package name with `validate-npm-package-name` → exit 1 on invalid.
4. **Detect publish command** from `packageManager` field / `npm_config_user_agent` (see below). If unsupported and `--no-publish` is not set → exit 1 with a message suggesting `--no-publish`. If `--no-publish` is set, detection is advisory only (used for the success hint).
5. **Registry existence check** via `npm-registry-fetch`. If the package exists → print `"<name> is already published — nothing to do."` and exit 0. **No file mutations.**
6. **Resolve access mode** (see decision matrix). May throw `AccessConflictError` → exit 2.
7. If resolved access differs from source: write back `publishConfig.access` (unless `--dry-run`). Preserve indent and EOL.
8. **Build stub manifest** (see field allow-list below).
9. If `--dry-run`: print stub manifest, exit 0.
10. Create disposable temp dir via `fs.promises.mkdtempDisposable`.
11. Write three files into it: `package.json` (stub manifest), `index.js` (`module.exports = {};`), `README.md` (placeholder).
12. `readdir` the temp dir — verify it contains exactly those three files. If wrong → print diff, exit 1. **Do not publish.**
13. `libnpmpack(dir)` → Buffer. Write tarball to temp dir as `${name-with-dashes}-0.0.0.tgz`.
14. **If `--no-publish`:** copy tarball to `--cwd` (same filename). Print:
    ```
    Stub packed to ./<tarball-name>
    Run your publish command to complete the initial publish, e.g.:
      yarn npm publish ./<tarball-name>
    ```
    Exit 0.
15. Spawn publish with `stdio: 'inherit'`. Forward `--registry` if it was explicitly passed on the CLI.
16. On success, print package URL (npmjs.com for public registry; registry URL otherwise).
17. Temp dir auto-cleans on scope exit (`await using`).

---

## Package Manager Detection

Resolution order — first match wins:

1. **`package.json#packageManager` field** (most explicit)
2. **Invocation context** via `process.env.npm_config_user_agent` (set by all major package managers when they invoke a script or dlx runner)
3. **Fallback:** `npm`

### `packageManager` field

| Value | Command |
|-------|---------|
| Starts with `npm@` | `npm publish <tarball>` |
| Starts with `pnpm@` | `pnpm publish <tarball> --no-git-checks` |
| Starts with `yarn@` or unrecognised | Exit 1: `"Unsupported package manager: yarn. Use --no-publish to prepare the stub tarball and publish it manually."` |

### Invocation context (when `packageManager` is absent)

`npm_config_user_agent` is set by npm, pnpm, and yarn whenever they spawn a child process or dlx runner. Example values:
- npm: `npm/10.x.x node/v24.x.x ...`
- pnpm: `pnpm/9.x.x npm/... node/v24.x.x ...`

Detection: check if the user agent string starts with `pnpm/` → use pnpm. Starts with `npm/` or absent → use npm. Starts with `yarn/` → unsupported (exit 1 unless `--no-publish` is set).

This means `pnpm dlx setup-trusted-publishing` with no `packageManager` field will automatically use `pnpm publish`, and `npx setup-trusted-publishing` will use `npm publish`.

### pnpm flag note

`--no-git-checks` is required for pnpm because the tarball is published from a temp dir that is not a git repository.

---

## Registry Auth

`packageExists` calls `npm-registry-fetch` with `forceAuth: { alwaysAuth: false }` so credentials are not leaked to arbitrary registries.

- **404** → package does not exist, proceed.
- **200** → package exists, exit 0.
- **401** → retry once without `forceAuth` (library resolves auth from the user's `.npmrc`). If the retry also fails non-404, surface the error and exit 1.
- Any other error → exit 1 with the error message.

---

## Access Resolution

### Decision matrix

| # | `source.private` | `source.publishConfig?.access` | `--access` flag | `--force` | Outcome |
|---|-----------------|-------------------------------|-----------------|-----------|---------|
| 1 | any | set | set, ≠ existing | false | **ERROR** `flag-vs-existing` → exit 2 |
| 2 | any | set | set, ≠ existing | true | Write flag value; record overwritten |
| 3 | true | unset | `public` | false | **ERROR** `flag-vs-private` → exit 2 |
| 4 | true | unset | `public` | true | Write `public` |
| 5 | any | unset | set (no conflict) | any | Write flag value |
| 6 | any | set | set, = existing | any | No change (matches) |
| 7 | any | set | unset | any | No change (keep existing) |
| 8 | true | unset | unset | any | Write `restricted` (inferred from `private`) |
| 9 | not true | unset | unset | any | Write `public` (default) |

### Return type

Pure function returning `{ value, reason, changed, overwrote? }` or throwing `AccessConflictError`.

`reason`: `'cli-flag' | 'existing' | 'inferred-private' | 'inferred-default'`

### Error messages

**`flag-vs-private`:**
```
--access public conflicts with "private": true in package.json.
If this package is genuinely intended for public release, remove "private": true from package.json.
To bypass this check, pass --force.
```

**`flag-vs-existing`:**
```
--access <flag> conflicts with existing publishConfig.access "<existing>" in package.json.
To overwrite the existing value, pass --force.
```

---

## Stub Manifest — Field Allow-List

Always set:
- `name` — copied from source (error if missing)
- `version` — forced to `"0.0.0"`
- `main` — forced to `"index.js"`

Copied if present and non-empty:
- `description` (placeholder string if absent)
- `author`, `contributors`, `license`, `homepage`, `repository`, `bugs`, `keywords`, `publishConfig`

The stub's `publishConfig` is the post-resolution value from step 6.

**Explicitly dropped:** `dependencies`, `scripts`, `bin`, `exports`, `files`, `type`, `engines`, `devDependencies`, `peerDependencies`, `optionalDependencies`, `workspaces`, and anything else not in the allow-list.

---

## Source File Mutation (`publishConfig.access`)

When the resolved access value differs from what's in the source:

- Round-trip: `JSON.parse` → mutate → `JSON.stringify(_, null, indent)`
- Detect indent via `/\n([ \t]+)"/` regex; default to `'  '` if no match
- Preserve trailing newline if the original had one
- If `publishConfig` is new: append it at the end of the object (npm convention)
- If `publishConfig` already exists: merge via `{ ...existing, access }` to preserve other keys

**Do not write:**
- During `--dry-run`
- When the package already exists on the registry (bail before this step)
- When the resolved value matches what's already in the source

---

## Success Output

Public registry (`registry.npmjs.org`):
```
Published <name>@0.0.0 → https://www.npmjs.com/package/<name>
```

Non-public registry:
```
Published <name>@0.0.0 to <registry-url>
```

"Package already exists" path has its own message and does not print a URL.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Published, package already on registry, or dry-run completed |
| 1 | Internal error: invalid `package.json`, registry lookup failure, stub verification failure, `npm`/`pnpm` publish exited non-zero, unsupported package manager |
| 2 | Bad CLI args or access conflict (use `--force` to bypass) |

---

## Testing

**Framework:** Node built-in (`node --test`). No network, no real publish.

**Mock surfaces:**
- `helpers/mock-registry.ts` — `http.createServer` returning 200 with a fake packument or 404
- `helpers/mock-npm.ts` — fake `npm`/`pnpm` script on a temp `PATH`; records args, exits 0 or non-zero on demand; verifies tarball path exists. **Not shipped in the package.**

### Access resolution (unit, pure function — ~10 tests)

- [ ] No `private`, no `publishConfig`, no flag → `public`, `inferred-default`
- [ ] `private: true`, no `publishConfig`, no flag → `restricted`, `inferred-private`
- [ ] No `private`, `publishConfig.access: public`, no flag → no change
- [ ] No `private`, no `publishConfig`, `--access restricted` → `restricted`, `cli-flag`
- [ ] `private: true`, no `publishConfig`, `--access public` → throws `flag-vs-private`
- [ ] `private: true`, no `publishConfig`, `--access public --force` → `public`, `cli-flag`
- [ ] `private: true`, no `publishConfig`, `--access restricted` → `restricted`, `cli-flag`
- [ ] `publishConfig.access: public`, `--access restricted` → throws `flag-vs-existing`
- [ ] `publishConfig.access: public`, `--access restricted --force` → `restricted`, `overwrote: 'public'`
- [ ] `publishConfig.access: public`, `--access public` → no change (matches)

### End-to-end (mock registry + mock npm)

- [ ] Package exists → exit 0, source `package.json` unchanged
- [ ] New package, no flags, no `private` → writes `access: public`, packs, publishes
- [ ] New package, `private: true` → writes `access: restricted`, packs, publishes
- [ ] `--dry-run` never writes source and never publishes
- [ ] `-n` works as alias for `--dry-run`
- [ ] Invalid `--access weird` → exit 2
- [ ] Unexpected file injected into stub dir between write and verify → exit 1, publish not called
- [ ] `npm publish` exits non-zero → propagate exit code
- [ ] Scoped package `@org/foo` → registry URL encoded correctly; tarball is `org-foo-0.0.0.tgz`
- [ ] Source `package.json` indent preserved (`  `, `    `, `\t`)
- [ ] Source `package.json` trailing-newline presence preserved
- [ ] Public registry success → output contains `https://www.npmjs.com/package/<name>`
- [ ] Non-npmjs.org registry success → output contains registry URL, not `npmjs.com`
- [ ] `packageManager: pnpm@9.0.0` → spawns `pnpm publish --no-git-checks`
- [ ] `packageManager: yarn@4.0.0` → exit 1 with unsupported message
- [ ] No `packageManager`, `npm_config_user_agent` starts with `pnpm/` → spawns `pnpm publish --no-git-checks`
- [ ] No `packageManager`, `npm_config_user_agent` starts with `npm/` → spawns `npm publish`
- [ ] No `packageManager`, no `npm_config_user_agent` → spawns `npm publish` (fallback)
- [ ] No `packageManager`, `npm_config_user_agent` starts with `yarn/` → exit 1 with unsupported message (suggests --no-publish)
- [ ] `--no-publish` → writes source `package.json`, packs tarball, copies it to `--cwd`, does not spawn publish, exits 0
- [ ] `--no-publish` with unsupported PM (yarn) → succeeds (exit 1 bypass; tarball placed in cwd)
- [ ] `--no-publish` + `--dry-run` together → exit 2
- [ ] `--no-publish` tarball filename matches `${name-with-dashes}-0.0.0.tgz` convention for scoped packages

---

## Implementation Sequencing

1. **`access.ts`** — pure function, no I/O. Lock down with unit tests first.
2. **`packument.ts`** — read/write with indent preservation. Test round-trips on varied `package.json` fixtures.
3. **`stub.ts`** — pure manifest builder + fs writes. Unit test `buildStubManifest`; integration test the written dir.
4. **`registry.ts`** — wraps `npm-registry-fetch`, `libnpmpack`, spawn. Test with mock registry + mock npm.
5. **`cli.ts`** — wires everything. Run end-to-end test scenarios.

---

## CI

GitHub Actions — lint + typecheck + tests on Node 24 and Node 26.

---

## Release

Changesets. One manual smoke test against the real registry before tagging `0.1.0` (fresh junk package name each time; unpublish within 72h — but note unpublishing locks the name for 24h, so use a fresh name each smoke test).

---

## Compatibility Notes (`dlx`-style runners)

- Read `package.json` from `process.cwd()` (`--cwd` flag), never from `import.meta.url`
- `bin` entry must have `#!/usr/bin/env node` shebang
- All scratch writes go to the `mkdtempDisposable` temp dir — never write next to the CLI itself
- `npm publish` spawned with `stdio: 'inherit'` to preserve OTP prompts and TTY
