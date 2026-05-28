---
'setup-trusted-publishing': patch
---

Use the correct path in the `--no-publish` stub tarball message when `--cwd` is specified.

Previously the message always showed `./package-0.0.0.tgz`. Now it shows the path relative to the working directory so the path in the example publish command is accurate when `--cwd` is used.
