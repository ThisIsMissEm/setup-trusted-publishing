---
'setup-trusted-publishing': minor
---

Automatically write `publishConfig.provenance: true` and `repository` URL to the source `package.json` during setup.

`provenance: true` enables npm provenance attestation on future publishes. The `repository` URL is detected from the git remote (`origin`) and normalised to a plain HTTPS string — SSH remotes and `git+https://` prefixes are converted automatically.

Neither field is written if already present. Both are written in a single file update to avoid multiple reads/writes.
