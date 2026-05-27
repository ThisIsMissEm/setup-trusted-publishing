---
'setup-trusted-publishing': major
---

Initial release of `setup-trusted-publishing`.

Publishes a minimal `0.0.0` stub package to npm so that OIDC trusted publishing can be configured — npm requires a package to exist before a trusted publisher can be attached to it.

Supports npm and pnpm. Handles scoped packages, resolves `publishConfig.access`, and detects missing auth with an actionable hint.

## Quick Start

```sh
# npm
npx setup-trusted-publishing

# pnpm
pnpm dlx setup-trusted-publishing
```
