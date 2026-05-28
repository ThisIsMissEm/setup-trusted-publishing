---
'setup-trusted-publishing': patch
---

Show detected package manager and source in `--no-publish` output.

When a supported package manager is detected, the tool now prints `Detected package manager: <pm> (<source>)` before the stub-packed message, making it easier to verify which package manager was detected and why.
