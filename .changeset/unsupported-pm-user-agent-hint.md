---
'setup-trusted-publishing': patch
---

Include the raw `npm_config_user_agent` value in the unsupported package manager error message.

This makes it easier to identify the exact user agent string when reporting support for a new package manager.
