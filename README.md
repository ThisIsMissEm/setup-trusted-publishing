# setup-trusted-publishing

Publish a minimal `0.0.0` stub to npm so you can configure OIDC trusted publishing.

npm's trusted publishing (provenance) requires a package to already exist on the registry before you can set it up. This tool handles that one-time initial publish — run it once, then configure trusted publishing on npmjs.com and let CI take over all real publishes.

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
3. Pins `publishConfig.access` in your `package.json` (so future CI publishes don't need `--access` flags)
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

## Further Reading

- [Trusted Publishers — npm docs](https://docs.npmjs.com/trusted-publishers)
- [Staged publishing and new install-time controls for npm](https://github.blog/changelog/2026-05-22-staged-publishing-and-new-install-time-controls-for-npm/)

## Requirements

Node.js `>=24.4.0`

## License

MIT
