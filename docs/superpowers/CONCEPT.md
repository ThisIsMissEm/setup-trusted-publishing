# setup-trusted-publishing — implementation plan

A small CLI that publishes a `0.0.0` metadata-only stub of the current package
to npm, so OIDC trusted publishing and staged publishing can be configured
against a package that already exists on the registry.

This is the design brief. Implement from scratch; verify all library and Node
APIs via **context7** (or the latest docs) before coding — versions and
signatures move.

---

## Problem

npm’s OIDC trusted publishing and the new stage-only trusted-publisher
configurations require the package to already exist on the registry before
they can be configured. Brand-new packages have a chicken-and-egg: they need
an initial publish before the secure publish flow they actually want can be
set up.

This tool handles that initial publish with a minimal stub. Run once per
package, then configure trusted publishing on npmjs.com and let CI take over.

## Scope

- One CLI binary, installed globally (`npm i -g setup-trusted-publishing`), or used via `pnpm dlx setup-trusted-publishing` (or `npx`, or `bunx`, etc).
- Reads the current package’s `package.json`, builds a `0.0.0` stub with only
  basic metadata, publishes it.
- If the package name already exists on the registry → exit 0, do nothing.
- Pins `publishConfig.access` on the source `package.json` so future CI
  publishes don’t need `--access` flags.
- Prints the next step for enabling someone to configure trusted publishing (the package URL on the registry or registry URL for registries other than registry.npmjs.com)

Out of scope: handling re-publishes, version bumps, unpublishing, anything
beyond the first publish.

## Target stack

- **TypeScript**, ESM (`"type": "module"`).
- **Node.js 24+** — we want `fs.promises.mkdtempDisposable` + `await using`,
  the latest `util.parseArgs`, top-level await.
- No bundler. Compile with `tsc`, ship `dist/`.
- Changesets for release tooling.

→ Confirm Node 24 API surface via context7 before relying on
`mkdtempDisposable`; it landed in 24.x.

## Dependencies

Two runtime deps, both first-party npm-org packages:

- **`npm-registry-fetch`** — for the registry existence check. Handles
  scope-slash encoding, proxies, CA config, registry URL resolution. Returns
  a fetch-like response; throws on non-2xx with `err.code === 'E404'` or
  `err.statusCode === 404` for not-found.
  → Look up current API on context7. Confirm the error shape on the latest
  major (404 catch is the part most likely to drift).
- **`libnpmpack`** — for packing the stub in-memory. Returns a `Buffer`.
  Same code `npm pack` runs. It also runs `prepack` / `postpack` lifecycle
  scripts if present; our stub has none, so this is a no-op.
  → Look up current API on context7. Confirm default-export shape and that
  passing a directory path still works (vs. needing a spec string).

**Not** using `libnpmpublish`. We shell out to `npm publish <tarball>`
instead — see “Why shell out for publish” below.

**Not** using `npm-packlist`. We control the temp dir contents (we just
wrote three files into it); a plain `fs.readdir` is sufficient and avoids
depending on the tree-walker for a directory we built ourselves.

**Not** using `tar` for inspection. Same reason — verify against the source
dir we wrote, not against the tarball after packing.

## Why shell out for `npm publish`

We could use `libnpmpublish` and remove the shell-out entirely. We choose
not to, because shelling lets the user’s existing publish pipeline work
without reimplementation:

- `.npmrc` resolution at user / project / global scopes
- OIDC token exchange in CI workflows
- Interactive OTP prompts via inherited stdio
- Provenance attestations
- Proxies, custom CAs, scoped registries
- `NPM_CONFIG_*` environment variables

Reimplementing this in-process means pulling in `@npmcli/config` (large) or
reimplementing config resolution (fragile). For a tool that runs once per
package lifetime, the shell-out has lower maintenance cost.

We should detect whether to use `npm publish` or a different command based on the environment, e.g., checking package.json for `packageManager` or which runner initiated the publish (`pnpm dlx`, `npx`, etc).

## Architecture

A handful of small modules. Keep `cli.ts` as the only file that touches
`process.argv` / `process.exit` / stdio; everything else returns values and
throws typed errors.

```
bin/
  cli.ts        Bin entrypoint, just invokes the default export from cli.ts
src/
  cli.ts        Entry point: arg parsing, orchestration, exit codes
  access.ts     publishConfig.access resolution + AccessConflictError
  packument.ts  Read/write source package.json, preserve indent + EOL
  stub.ts       Build stub manifest, write stub dir, list/verify files
tests/
  mock-registry.ts   packageExists, libnpmpack wrapper, npm publish shell-out
```

Single-file is also fine if the agent prefers. The split above is suggestive,
not prescriptive.

## Flow

1. Parse args (see “CLI” below). On invalid args → exit 2.
1. Read `package.json` from `--cwd`. Cache raw text, parsed object, detected
   indent, and trailing-newline presence (we’ll need them to write back without
   churning the file).
1. **Registry existence check** via `npm-registry-fetch`. If the package
   exists → print a message and exit 0. **Do not touch source files.**
1. **Resolve access mode** (see access matrix below). May throw
   `AccessConflictError` → exit 2.
1. If the resolved access differs from what’s in the source, **write back**
   `publishConfig.access` to the source `package.json` (unless `--dry-run`).
   Preserve indent and EOL.
1. **Build stub manifest** — see “Field carry-over” below.
1. If `--dry-run`: print the stub manifest and exit 0.
1. Create disposable temp dir via `fs.promises.mkdtempDisposable`.
1. Write three files into it: `package.json` (stub manifest), `index.js`
   (`module.exports = {};`), `README.md` (placeholder explanation).
1. `readdir` the temp dir and verify it contains _exactly_ those three
   files. If not → print the diff and exit 1. **Do not publish.**
1. `libnpmpack(dir)` → tarball Buffer. Write to disk as
   `${name-with-dashes}-0.0.0.tgz` in the temp dir.
1. `spawn('npm', ['publish', tarballName], { cwd: dir, stdio: 'inherit' })`.
   Resolve with the exit code.
1. On success, print the **package URL** so the user can click straight
   through to configure trusted publishing — see “Success output” below.
1. Temp dir auto-cleans on scope exit (`await using`).

## CLI

```
setup-trusted-publishing [options]

  -n, --dry-run        Build the stub but do not publish or write the source
      --access <mode>  'public' or 'restricted'
  -f, --force          Bypass access conflict errors, conflicts with --dry-run
      --registry <url> Registry to check and publish to
                       (default: $NPM_CONFIG_REGISTRY or registry.npmjs.org)
  -C  --cwd <path>     Source package directory (default: cwd)
  -h, --help
```

Use `node:util` `parseArgs` with `strict: true`, `allowPositionals: false`.
Reject any unknown args.

→ Verify `parseArgs` short-flag and `=` syntax behavior on Node 24 via
context7; it’s been growing options.

## Access resolution

Inputs:

- `source.private` (boolean | undefined)
- `source.publishConfig?.access` (`'public'` | `'restricted'` | undefined)
- `--access` flag (`'public'` | `'restricted'` | null)
- `--force` flag (boolean)

**Decision matrix** (evaluation order):

| #   | source `private` | source `pc.access` | `--access`        | `--force` | outcome                                      |
| --- | ---------------- | ------------------ | ----------------- | --------- | -------------------------------------------- |
| 1   | any              | set                | set, ≠            | false     | **ERROR** `flag-vs-existing` → exit 2        |
| 2   | any              | set                | set, ≠            | true      | write flag value; record overwritten         |
| 3   | true             | unset              | `public`          | false     | **ERROR** `flag-vs-private` → exit 2         |
| 4   | true             | unset              | `public`          | true      | write `public`                               |
| 5   | any              | unset              | set (no conflict) | any       | write flag value                             |
| 6   | any              | set                | set, =            | any       | no change (matches)                          |
| 7   | any              | set                | unset             | any       | no change (keep existing)                    |
| 8   | true             | unset              | unset             | any       | write `restricted` (inferred from `private`) |
| 9   | not true         | unset              | unset             | any       | write `public` (default)                     |

Encode this as a pure function returning either `{ value, reason, changed, overwrote? }` or throwing `AccessConflictError` with a typed `conflict`
property. Have `reason` carry one of `'cli-flag' | 'existing' | 'inferred-private' | 'inferred-default'` so the CLI can render a useful
annotation in its output.

### Error messages

- `flag-vs-private`:

> `--access public conflicts with "private": true in package.json. If this package is genuinely intended for public release, remove "private": true from package.json. To bypass this check, pass --force.`

- `flag-vs-existing`:

> `--access <flag> conflicts with existing publishConfig.access "<existing>" in package.json. To overwrite the existing value, pass --force.`

## Field carry-over

Stub manifest contains:

- `name` — copied from source (required; error if missing)
- `version` — forced to `"0.0.0"`
- `main` — forced to `"index.js"`
- `description` — copied if present; otherwise a placeholder string
- And copied if present and non-empty: `author`, `contributors`, `license`,
  `homepage`, `repository`, `bugs`, `keywords`, `publishConfig`

Explicitly **dropped**: `dependencies`, `scripts`, `bin`, `exports`, `files`,
`type`, `engines`, `devDependencies`, `peerDependencies`, `optionalDependencies`,
`workspaces`, anything else not in the allow-list. These could cause publish
to fail or install to misbehave for a stub with no real code.

The stub’s `publishConfig` is the post-resolution one — by step 6 in the flow,
the source has been updated (or the existing value confirmed), so the stub’s
manifest matches what future publishes will see.

## Source file mutation

When `publishConfig.access` changes:

- Round-trip via `JSON.parse` → mutate → `JSON.stringify(_, null, indent)`.
- Detect indent from the original file (regex: `/\n([ \t]+)"/` is a decent
  heuristic, default to `'  '` if no match).
- Preserve trailing newline if the original had one.
- `publishConfig` lands at the end of the object if newly added — that’s the
  npm convention. If `publishConfig` already exists, preserve its other keys
  via `{ ...existing, access }`.

**Do not** write to the source file:

- During `--dry-run`
- When the package already exists on the registry (we bail before this step)
- When the resolved value matches what’s already there

## Success output

After a successful publish, print a final line containing the package URL so
the user can click straight through to configure trusted publishing:

```
Published <name>@0.0.0 → https://www.npmjs.com/package/<name>
```

The `https://www.npmjs.com/package/<name>` form works for both unscoped names
(`foo`) and scoped names (`@org/foo`) on the public registry.

For non-public registries (anything where the resolved registry host isn’t
`registry.npmjs.org`), omit the URL — `npmjs.com` won’t have the package, and
guessing the view URL for an arbitrary private registry is unreliable.
Suggested fallback line:

```
Published <name>@0.0.0 to <registry-url>
```

The “package already exists” path has its own message (step 3) and shouldn’t
print this URL — the user didn’t publish anything in that case.

## Exit codes

| Code | Meaning                                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------- |
| 0    | Published, package already on registry, or dry-run completed                                                           |
| 1    | Internal error: bad `package.json`, registry lookup failed, stub verification failed, or `npm publish` exited non-zero |
| 2    | Bad CLI args or access conflict (use `--force` to bypass)                                                              |

## Implementation sequencing

Suggested order. Each step should be testable on its own before moving on.

1. **`access.ts`** — pure function, no I/O. The decision matrix is the
   logical core; lock it down with unit tests first. ~10 tests covers it.
1. **`packument.ts`** — read/write package.json with indent preservation. Test
   round-tripping on a few realistic package.json files. Verify behavior with
   tabs, four-space indent, no trailing newline.
1. **`stub.ts`** — pure manifest builder plus a couple of fs writes. Unit
   tests on `buildStubManifest` (carry-over correctness, drop list, version
   forcing, name required); integration test that writes a stub dir and
   reads it back.
1. **`mock-registry.ts`** — wraps the two libs. Stand up a tiny `http.createServer`
   mock registry for `packageExists` tests (200/404). For `packStub` and
   `runNpmPublish`, integration-test against a fake `npm` on PATH that
   accepts `publish <tarball>` and exits 0/non-zero on demand.
1. **`cli.ts`** — wires everything together. Run the test scenarios in the
   checklist below end-to-end.

## Test scenarios (checklist)

Mock the two external surfaces — don’t reach for a real registry or a real
npm install. The setup is small:

- **Mock registry:** a tiny `http.createServer` returning 200 with a fake
  packument for names you want to look “already published”, and 404 for
  everything else. Pass its URL as `--registry`.
- **Mock npm:** a tiny `bin/npm` script (Node or shell) on a temp `PATH` that
  records the args and exits 0 (or non-zero to test failure paths). The CLI
  shells out to `npm publish <tarball>`, so the mock can also verify the
  tarball file exists at the path it was given. This should not be part of the bin scripts for the package, it's only use is for testing.

This is enough for everything below. No verdaccio, no real publishes during
CI.

Access resolution (unit tests, pure function):

- [ ] Plain new package, no `private`, no `publishConfig` → `public`, inferred-default
- [ ] `private: true`, no `publishConfig`, no flag → `restricted`, inferred-private
- [ ] No `private`, `publishConfig.access` already `public`, no flag → no change
- [ ] No `private`, no `publishConfig`, `--access restricted` → `restricted`, cli-flag
- [ ] `private: true`, no `publishConfig`, `--access public` → throws `flag-vs-private`
- [ ] `private: true`, no `publishConfig`, `--access public --force` → `public`, cli-flag
- [ ] `private: true`, no `publishConfig`, `--access restricted` → `restricted`, cli-flag
- [ ] `publishConfig.access: public`, `--access restricted` → throws `flag-vs-existing`
- [ ] `publishConfig.access: public`, `--access restricted --force` → `restricted`, overwrote: ‘public’
- [ ] `publishConfig.access: public`, `--access public` → no change (matches)

End-to-end (against mock registry + mock npm):

- [ ] Package exists on registry → exits 0, source `package.json` unchanged
- [ ] New package, no flags, no `private` → writes `access: public`, packs, publishes
- [ ] New package, `private: true` → writes `access: restricted`, packs, publishes
- [ ] `--dry-run` never writes source and never publishes
- [ ] `-n` works as alias for `--dry-run`
- [ ] Invalid `--access weird` → exit 2 with usage error
- [ ] Stub dir contains an unexpected file (inject one between write and
      verify in a test harness) → exit 1, **publish not called**
- [ ] `npm publish` exits non-zero → propagate that exit code
- [ ] Scoped package name (`@org/foo`) → registry URL is encoded correctly,
      tarball name is `org-foo-0.0.0.tgz`
- [ ] Source `package.json` indent is preserved (try `  `, `    `, `\t`)
- [ ] Source `package.json` trailing-newline presence is preserved
- [ ] Success on `registry.npmjs.org` → output contains
      `https://www.npmjs.com/package/<name>`
- [ ] Success on a non-npmjs.org registry → output contains the registry URL
      but NOT `npmjs.com`

## Open questions

These need a decision before shipping. Resolve them or surface them in a
README “known limitations” section.

- **Should `--registry` be forwarded to `npm publish`?** Currently the design
  doesn’t pass `--registry` to the spawned `npm publish` — npm reads its own
  config. But a user passing `--registry foo` probably wants both calls to
  hit `foo`. **Suggested resolution:** if `--registry` was explicitly given,
  forward it as `--registry=${args.registry}` to the spawn args. If it came
  from `$NPM_CONFIG_REGISTRY`, npm sees it already.
- **Auth on the registry existence check.** We pass `forceAuth: { alwaysAuth: false }` so we don’t leak credentials to whatever registry the user pointed
  at. Private registries that require auth even for packument GETs will see
  this fail with 401 instead of 200/404. **Suggested resolution:** if
  `packageExists` gets a 401, retry with auth from the user’s `.npmrc`
  (`npm-registry-fetch` resolves this when `forceAuth` is unset).
- **What if `name` contains uppercase, leading-dot, or other invalid chars?**
  We forward it as-is; the registry / `npm publish` will reject it eventually.
  **Suggested resolution:** validate locally with `validate-npm-package-name`
  (another small first-party lib) before any work, so the user gets a fast
  error instead of failing mid-publish.

## Compatibility with `dlx`-style runners

The CLI is designed to be invoked via `pnpm dlx <name>`, `npx <name>`, or
`bunx <name>` from inside the user's project directory. This works for free
as long as the implementation respects a few constraints:

- **Read the user's `package.json` from `process.cwd()`, never from the
  CLI's own install location.** `dlx` runners cache the package in a global
  store; `__dirname` and `import.meta.url` point at the cache, not the
  user's project. The `--cwd` flag (defaulting to `process.cwd()`) is the
  only correct source.

- **The `bin` entry must point at a file with a `#!/usr/bin/env node`
  shebang on its first line.** When publishing, npm sets the executable bit
  on files listed in `bin` automatically, so no extra packaging step is
  needed — but the shebang must be in the source so dev-mode runs and
  symlinked installs work too.

- **Keep startup cheap.** `dlx` users pay the install cost on every
  invocation if the package isn't cached. Two runtime deps (`libnpmpack`,
  `npm-registry-fetch`) is fine; resist adding more unless they earn their
  keep.

- **Don't assume a writable install dir.** All scratch writes go to a
  `mkdtempDisposable` temp dir; never write next to the CLI itself.

- **Stdio must stay interactive.** `npm publish` is shelled out with
  `stdio: 'inherit'` so OTP prompts surface. `dlx` runners preserve TTY by
  default, but the implementation shouldn't pipe or capture stdio for the
  publish step.

Test this by running `pnpm dlx <local-tarball-path>` against a mock-npm
registry before tagging. A successful dlx invocation against a real package
fixture is the cleanest end-to-end signal that nothing is wrong.

## Final deliverables

- `bin/cli.ts` the CLI entrypoint
- `src/*.ts` compiling under strict TS
- `tsconfig.json`, `package.json` (with `bin`, `engines.node: ">=24"`,
  `type: module`)
- Unit + integration tests, all using mocks (no network, no real npm
  publish). Node’s built-in test runner via `node --test` is fine, or pick
  vitest / tap — agent’s call.
- A user-facing `README.md` (separate from this design doc) with
  install/usage/flags/exit-codes
- CI: GitHub Actions running lint + tests on Node 24 and 26
- **One** manual smoke test against the real registry before tagging 0.1.0,
  using a junk package name. Within 72 hours you can `npm unpublish` it (if
  no dependents) — but be aware that an unpublish locks the name out from
  new publishes for 24 hours, so use a fresh name each smoke test rather
  than recycling.
