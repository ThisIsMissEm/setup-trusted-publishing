import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { registryFetch, packPackage } from './npm.ts'
// ── Package manager detection ─────────────────────────────────────────────

export type SupportedPM = 'npm' | 'pnpm'
export type PMDetectionResult =
  | {
      pm: SupportedPM
      source: 'packageManager-field' | 'user-agent' | 'fallback'
    }
  | { pm: null; unsupported: string }

/**
 * Resolves which package manager to use for `publish`.
 *
 * @param packageManagerField - value of `package.json#packageManager` (e.g. "pnpm@9.0.0")
 * @param userAgent - value of `process.env.npm_config_user_agent`
 */
export function detectPackageManager(
  packageManagerField: string | undefined,
  userAgent: string | undefined
): PMDetectionResult {
  // 1. packageManager field
  if (packageManagerField) {
    const name = packageManagerField.split('@')[0] ?? ''
    if (name === 'npm') return { pm: 'npm', source: 'packageManager-field' }
    if (name === 'pnpm') return { pm: 'pnpm', source: 'packageManager-field' }
    return { pm: null, unsupported: name }
  }

  // 2. npm_config_user_agent
  if (userAgent) {
    if (userAgent.startsWith('pnpm/')) return { pm: 'pnpm', source: 'user-agent' }
    if (userAgent.startsWith('yarn/')) return { pm: null, unsupported: 'yarn' }
    return { pm: 'npm', source: 'user-agent' }
  }

  // 3. Fallback
  return { pm: 'npm', source: 'fallback' }
}

// ── Registry existence check ──────────────────────────────────────────────

/**
 * Checks whether a package exists on the registry using npm-registry-fetch.
 * Handles .npmrc auth, proxy config, and CA certificates automatically.
 *
 * - 200 → exists (return true)
 * - 404 → does not exist (return false)
 * - 401 → retry once without forceAuth so .npmrc credentials are used
 *          (private registries may require auth even for existence checks)
 */
export async function packageExists(
  name: string,
  opts: { registry?: string } = {}
): Promise<boolean> {
  // Encode scoped names: @org/pkg → @org%2Fpkg (keep @, encode /)
  const escapedName = name.startsWith('@') ? '@' + name.slice(1).replace('/', '%2F') : name

  // Always bypass the proxy for loopback addresses, and necessary in tests
  // where the mock registry runs on localhost but http_proxy / https_proxy may
  // be set in the environment (e.g. by Socket Firewall wrapping the parent
  // process). Merge with any existing no_proxy / NO_PROXY env vars so user
  // exclusions are preserved.
  const envProxy = process.env['no_proxy'] ?? process.env['NO_PROXY'] ?? ''
  const noProxy = ['localhost', '127.0.0.1', '::1', envProxy].filter(Boolean).join(',')

  const attempt = async (fetchOpts: Record<string, unknown>): Promise<boolean | null> => {
    try {
      const res = await registryFetch(escapedName, fetchOpts)
      res.body.resume() // drain so the socket is released
      return true // 200
    } catch (e: unknown) {
      const err = e as { statusCode?: number }
      if (err.statusCode === 404) return false
      if (err.statusCode === 401) return null // signal: retry with auth
      throw e
    }
  }

  // First attempt: forceAuth off so credentials are not sent to arbitrary registries
  const first = await attempt({
    registry: opts.registry,
    forceAuth: { alwaysAuth: false },
    noProxy,
  })
  if (first !== null) return first

  // 401: retry letting npm-registry-fetch resolve auth from .npmrc
  const second = await attempt({ registry: opts.registry, noProxy })
  if (second === null) throw new Error(`Registry auth required for "${name}" — not logged in`)
  return second
}

// ── Tarball packing ───────────────────────────────────────────────────────

/** Pack the stub directory into a tarball Buffer using libnpmpack. */
export async function packStub(dir: string): Promise<Buffer> {
  return await packPackage(`file:${dir}`, { ignoreScripts: true })
}

// ── Publish spawn ─────────────────────────────────────────────────────────

export interface RunPublishOptions {
  pm: SupportedPM
  tarballPath: string
  cwd: string
  registry?: string
  /** Override process.env for testing; defaults to process.env */
  env?: NodeJS.ProcessEnv
}

export interface RunPublishResult {
  exitCode: number
  /** True when stderr contained both "E404" and "PUT" — likely an auth error. */
  looksLikeAuthError: boolean
}

/**
 * Spawns `npm publish <tarball>` or `pnpm publish <tarball> --no-git-checks`.
 * Pipes stderr through a Transform that watches for E404+PUT without buffering.
 */
export async function runPublish(opts: RunPublishOptions): Promise<RunPublishResult> {
  const { pm, tarballPath, cwd, registry, env } = opts

  const args = ['publish', tarballPath]
  // pnpm always runs git checks, even though we're publishing a pre-built tarball:
  if (pm === 'pnpm') args.push('--no-git-checks')
  if (registry) args.push(`--registry=${registry}`)

  return new Promise((resolve, reject) => {
    let sawE404 = false
    let sawPut = false

    const stderrSpy = new PassThrough()
    stderrSpy.on('data', (chunk: Buffer) => {
      if (sawE404 && sawPut) return
      const text = chunk.toString('utf8')
      if (!sawE404 && text.includes('E404')) sawE404 = true
      if (sawE404 && !sawPut && text.includes(' PUT ')) sawPut = true
    })

    const child = spawn(pm, args, {
      cwd,
      stdio: ['inherit', 'inherit', 'pipe'],
      env: env ?? process.env,
    })

    // stdio[2] === 'pipe' guarantees child.stderr is a Readable, not null
    child.stderr!.pipe(stderrSpy).pipe(process.stderr)

    child.on('exit', (code) =>
      resolve({ exitCode: code ?? 1, looksLikeAuthError: sawE404 && sawPut })
    )
    child.on('error', reject)
  })
}
