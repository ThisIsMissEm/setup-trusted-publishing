# setup-trusted-publishing

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
