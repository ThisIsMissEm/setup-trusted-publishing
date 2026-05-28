import { createRequire } from 'node:module'
// CJS interop for CommonJS modules that don't support ESM imports natively
const cjsRequire = createRequire(import.meta.url)

export const packPackage = cjsRequire('libnpmpack') as (
  spec: string,
  opts?: Record<string, unknown>
) => Promise<Buffer>

export const registryFetch = cjsRequire('npm-registry-fetch') as (
  uri: string,
  opts?: Record<string, unknown>
) => Promise<{ body: { resume(): void } }>
