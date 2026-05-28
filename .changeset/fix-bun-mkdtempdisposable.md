---
'setup-trusted-publishing': patch
---

Fix compatibility with Bun: `mkdtempDisposable` was added in Node.js v24 and is not yet available in Bun. Replaced with an inline implementation using `mkdtemp` + `rm`.
