# setup-trusted-publishing

## 1.0.0

### Major Changes

- [#1](https://github.com/ThisIsMissEm/setup-trusted-publishing/pull/1) [`7dd6ead`](https://github.com/ThisIsMissEm/setup-trusted-publishing/commit/7dd6ead89d9dc8f21324bd2f28bc14a8a86d512e) Thanks [@ThisIsMissEm](https://github.com/ThisIsMissEm)! - Initial release of `setup-trusted-publishing`.

  Publishes a minimal `0.0.0` stub package to npm so that OIDC trusted publishing can be configured — npm requires a package to exist before a trusted publisher can be attached to it.

  Supports npm and pnpm. Handles scoped packages, resolves `publishConfig.access`, and detects missing auth with an actionable hint.

  ## Quick Start

  ```sh
  # npm
  npx setup-trusted-publishing

  # pnpm
  pnpm dlx setup-trusted-publishing
  ```
