---
'setup-trusted-publishing': minor
---

`--force` now also bypasses the "already published — nothing to do" early exit.

Previously `--force` only suppressed access-conflict errors. It now additionally re-runs the full setup flow even when the package already exists on the registry, which is useful for re-publishing the stub or testing the setup against an existing package.
