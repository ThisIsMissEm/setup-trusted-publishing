# setup-trusted-publishing

## 1.0.2

### Patch Changes

- [#18](https://github.com/ThisIsMissEm/setup-trusted-publishing/pull/18) [`6733e21`](https://github.com/ThisIsMissEm/setup-trusted-publishing/commit/6733e21e90e19b22186481b6778383daab575dde) Thanks [@ThisIsMissEm](https://github.com/ThisIsMissEm)! - Fix compatibility with Bun: `mkdtempDisposable` was added in Node.js v24 and is not yet available in Bun. Replaced with an inline implementation using `mkdtemp` + `rm`.

## 1.0.1

### Patch Changes

- [#17](https://github.com/ThisIsMissEm/setup-trusted-publishing/pull/17) [`41cc05e`](https://github.com/ThisIsMissEm/setup-trusted-publishing/commit/41cc05e91dd51005b5da0b100b55227919a58294) Thanks [@ThisIsMissEm](https://github.com/ThisIsMissEm)! - Use the correct path in the `--no-publish` stub tarball message when `--cwd` is specified.

  Previously the message always showed `./package-0.0.0.tgz`. Now it shows the path relative to the working directory so the path in the example publish command is accurate when `--cwd` is used.

- [#17](https://github.com/ThisIsMissEm/setup-trusted-publishing/pull/17) [`41cc05e`](https://github.com/ThisIsMissEm/setup-trusted-publishing/commit/41cc05e91dd51005b5da0b100b55227919a58294) Thanks [@ThisIsMissEm](https://github.com/ThisIsMissEm)! - Show detected package manager and source in `--no-publish` output.

  When a supported package manager is detected, the tool now prints `Detected package manager: <pm> (<source>)` before the stub-packed message, making it easier to verify which package manager was detected and why.

- [#16](https://github.com/ThisIsMissEm/setup-trusted-publishing/pull/16) [`30e81e9`](https://github.com/ThisIsMissEm/setup-trusted-publishing/commit/30e81e9c632dd03de0c1b4fe5cdf870a8c16bab2) Thanks [@ThisIsMissEm](https://github.com/ThisIsMissEm)! - Update README.md with more information

- [#14](https://github.com/ThisIsMissEm/setup-trusted-publishing/pull/14) [`ef0a28e`](https://github.com/ThisIsMissEm/setup-trusted-publishing/commit/ef0a28e5c12a3fd93fd78ddc693f7a64dc3c1e08) Thanks [@ThisIsMissEm](https://github.com/ThisIsMissEm)! - Include the raw `npm_config_user_agent` value in the unsupported package manager error message.

  This makes it easier to identify the exact user agent string when reporting support for a new package manager.

## 1.0.0

### Major Changes

- [#8](https://github.com/ThisIsMissEm/setup-trusted-publishing/pull/8) [`016b369`](https://github.com/ThisIsMissEm/setup-trusted-publishing/commit/016b369c28c769332a2e54d1f5acca209d16cf6c) Thanks [@ThisIsMissEm](https://github.com/ThisIsMissEm)! - Initial release of `setup-trusted-publishing`.

  Publishes a minimal `0.0.0` stub package to npm so that OIDC trusted publishing can be configured — npm requires a package to exist before a trusted publisher can be attached to it.

  Supports npm and pnpm. Handles scoped packages, resolves `publishConfig.access`, and detects missing auth with an actionable hint.

  ## Quick Start

  ```sh
  # npm
  npx setup-trusted-publishing

  # pnpm
  pnpm dlx setup-trusted-publishing
  ```

### Minor Changes

- [#11](https://github.com/ThisIsMissEm/setup-trusted-publishing/pull/11) [`1002521`](https://github.com/ThisIsMissEm/setup-trusted-publishing/commit/10025219ffcf00973c1e5440d4d9b52370f35427) Thanks [@ThisIsMissEm](https://github.com/ThisIsMissEm)! - Automatically write `publishConfig.provenance: true` and `repository` URL to the source `package.json` during setup.

  `provenance: true` enables npm provenance attestation on future publishes. The `repository` URL is detected from the git remote (`origin`) and normalised to a plain HTTPS string — SSH remotes and `git+https://` prefixes are converted automatically.

  Neither field is written if already present. Both are written in a single file update to avoid multiple reads/writes.

- [#11](https://github.com/ThisIsMissEm/setup-trusted-publishing/pull/11) [`1002521`](https://github.com/ThisIsMissEm/setup-trusted-publishing/commit/10025219ffcf00973c1e5440d4d9b52370f35427) Thanks [@ThisIsMissEm](https://github.com/ThisIsMissEm)! - `--force` now also bypasses the "already published — nothing to do" early exit.

  Previously `--force` only suppressed access-conflict errors. It now additionally re-runs the full setup flow even when the package already exists on the registry, which is useful for re-publishing the stub or testing the setup against an existing package.

### Patch Changes

- [#11](https://github.com/ThisIsMissEm/setup-trusted-publishing/pull/11) [`1002521`](https://github.com/ThisIsMissEm/setup-trusted-publishing/commit/10025219ffcf00973c1e5440d4d9b52370f35427) Thanks [@ThisIsMissEm](https://github.com/ThisIsMissEm)! - Post-publish hints are now shown when using `--no-publish`.

  The missing-metadata hint and the repository URL case-sensitivity reminder were previously only shown after a live publish. They now also appear after `--no-publish` packs the tarball, since the same follow-up steps apply.
