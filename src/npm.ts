import { createRequire } from "node:module";
// eslint-disable @typescript-eslint/no-require-imports
// CJS interop for CommonJS modules that don't support ESM imports natively
const require = createRequire(import.meta.url);

export const packPackage = require("libnpmpack") as (
  spec: string,
  opts?: Record<string, unknown>,
) => Promise<Buffer>;

export const registryFetch = require("npm-registry-fetch") as (
  uri: string,
  opts?: Record<string, unknown>,
) => Promise<{ body: { resume(): void } }>;
// eslint-enable @typescript-eslint/no-require-imports
