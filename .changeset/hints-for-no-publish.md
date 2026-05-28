---
'setup-trusted-publishing': patch
---

Post-publish hints are now shown when using `--no-publish`.

The missing-metadata hint and the repository URL case-sensitivity reminder were previously only shown after a live publish. They now also appear after `--no-publish` packs the tarball, since the same follow-up steps apply.
