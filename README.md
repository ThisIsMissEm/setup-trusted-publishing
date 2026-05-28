# setup-trusted-publishing

Publish a minimal `0.0.0` stub to npm so you can configure OIDC trusted publishing.

npm's trusted publishing (provenance) requires a package to already exist on the registry before you can set it up. This tool handles that one-time initial publish — run it once, then configure trusted publishing on npm and let CI take over all real publishes.

If the package already exists, the tool exits `0` and does nothing.

## Quick Start

```sh
# npm
npx setup-trusted-publishing

# pnpm
pnpm dlx setup-trusted-publishing
```

Run from your package directory (or pass `--cwd <dir>`).

On success it prints the package URL so you can click through to configure trusted publishing.

## What It Does

1. Reads your `package.json`
2. Checks if the package already exists on the registry — exits `0` if it does
3. Writes to your `package.json` (if not already set): `publishConfig.access` (see [Access resolution](#access-resolution)), `publishConfig.provenance: true`, and `repository` (auto-detected from git remote)
4. Publishes a minimal stub (`0.0.0`, no real source) to reserve the name

## Options

| Flag               | Short | Description                                                                                                                                           |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`        | `-n`  | Print the stub manifest without publishing or writing anything                                                                                        |
| `--no-publish`     |       | Write `publishConfig.access`, pack the stub tarball, copy it to `--cwd` — but don't publish. For package managers not directly supported (e.g. yarn). |
| `--access <mode>`  |       | Set access to `public` or `restricted`. Required for scoped packages with no existing `publishConfig.access`.                                         |
| `--force`          | `-f`  | Bypass access conflict errors (e.g. `--access public` conflicting with an existing `restricted` setting)                                              |
| `--registry <url>` |       | Registry to check and publish to (defaults to your `.npmrc` / npm default)                                                                            |
| `--cwd <path>`     | `-C`  | Source package directory (defaults to current directory)                                                                                              |
| `--help`           | `-h`  | Show help                                                                                                                                             |

## Scoped Packages

Scoped packages (`@org/name`) default to restricted access on npm. You must explicitly set the access level — either via `--access`, `publishConfig.access` in your `package.json`, or `"private": true`.

```sh
# Publish as public
pnpm dlx setup-trusted-publishing --access public

# Publish as restricted (private registry / npm Teams)
pnpm dlx setup-trusted-publishing --access restricted
```

## Supported Package Managers

Detected automatically from `package.json#packageManager` or `npm_config_user_agent`:

| Package manager | Support                                                       |
| --------------- | ------------------------------------------------------------- |
| npm             | Full                                                          |
| pnpm            | Full                                                          |
| yarn            | Use `--no-publish` to pack the tarball, then publish manually |

## The Stub Package

The published tarball contains exactly three files:

| File           | Contents                                         |
| -------------- | ------------------------------------------------ |
| `package.json` | See below                                        |
| `index.js`     | `module.exports = {};` — a no-op CommonJS module |
| `README.md`    | A one-line notice identifying this as a stub     |

### Stub `package.json`

Fields always included:

- `name` — from your source `package.json`
- `version` — always `"0.0.0"`
- `main` — always `"index.js"`
- `description` — from source, or `"Stub package for npm trusted publishing setup"` if absent
- `publishConfig.access` — resolved access level (see [Access resolution](#access-resolution))

Fields copied from source if present and non-empty: `author`, `contributors`, `license`, `homepage`, `repository`, `bugs`, `keywords`

Fields **not** copied into the stub: `dependencies`, `devDependencies`, `peerDependencies`, `scripts`, `bin`, `exports`, `type`, `engines`, and `publishConfig.provenance` (provenance is a publish-time OIDC flag that errors when passed via a tarball — your CI publishes set it from your updated source `package.json`)

### Access resolution

`publishConfig.access` is resolved in this priority order and written to your source `package.json` when changed:

| Condition                                                      | Resolved value                                  | Written to source `package.json`? |
| -------------------------------------------------------------- | ----------------------------------------------- | --------------------------------- |
| `--access <flag>` differs from existing `publishConfig.access` | **error** — use `--force` to overwrite          | —                                 |
| `--access public` when `"private": true`                       | **error** — remove `"private"` or use `--force` | —                                 |
| `--access <flag>` matches existing `publishConfig.access`      | existing value                                  | no                                |
| `--access <flag>`, no existing value                           | flag value                                      | yes                               |
| No flag, `publishConfig.access` already set                    | existing value                                  | no                                |
| No flag, `"private": true`                                     | `restricted`                                    | yes                               |
| No flag, no existing, not private                              | `public`                                        | yes                               |

## Further Reading

- [Trusted Publishers — npm docs](https://docs.npmjs.com/trusted-publishers)
- [Staged publishing and new install-time controls for npm](https://github.blog/changelog/2026-05-22-staged-publishing-and-new-install-time-controls-for-npm/)

## Requirements

Node.js `>=24.4.0`

## License

MIT
