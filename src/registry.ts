import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createRequire } from 'node:module';

// CJS interop for CommonJS modules that don't support ESM imports natively
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const libnpmpack = require('libnpmpack') as (spec: string, opts?: Record<string, unknown>) => Promise<Buffer>;

// ── Package manager detection ─────────────────────────────────────────────

export type SupportedPM = 'npm' | 'pnpm';

export type PMDetectionResult =
  | { pm: SupportedPM; source: 'packageManager-field' | 'user-agent' | 'fallback' }
  | { pm: null; unsupported: string };

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
    const name = packageManagerField.split('@')[0] ?? '';
    if (name === 'npm') return { pm: 'npm', source: 'packageManager-field' };
    if (name === 'pnpm') return { pm: 'pnpm', source: 'packageManager-field' };
    return { pm: null, unsupported: name };
  }

  // 2. npm_config_user_agent
  if (userAgent) {
    if (userAgent.startsWith('pnpm/')) return { pm: 'pnpm', source: 'user-agent' };
    if (userAgent.startsWith('yarn/')) return { pm: null, unsupported: 'yarn' };
    return { pm: 'npm', source: 'user-agent' };
  }

  // 3. Fallback
  return { pm: 'npm', source: 'fallback' };
}

// ── Registry existence check ──────────────────────────────────────────────

/**
 * Uses node:http / node:https directly to check whether a package exists on
 * the registry. Avoids make-fetch-happen (used by npm-registry-fetch) which
 * can be intercepted by network-level tools (e.g. Socket Firewall) in ways
 * that break localhost test servers.
 */
export async function packageExists(
  name: string,
  opts: { registry?: string } = {}
): Promise<boolean> {
  const registryBase = (opts.registry ?? 'https://registry.npmjs.org').replace(/\/$/, '');
  // Encode scoped names: @org/pkg → @org%2Fpkg (keep @, encode /)
  const escapedName = name.startsWith('@')
    ? '@' + name.slice(1).replace('/', '%2F')
    : name;

  const url = `${registryBase}/${escapedName}`;
  const parsedUrl = new URL(url);
  const req = parsedUrl.protocol === 'https:' ? httpsRequest : httpRequest;

  const statusCode = await new Promise<number>((resolve, reject) => {
    const r = req(url, { method: 'GET', headers: { accept: 'application/json' } }, (res) => {
      res.resume(); // drain so the socket is released
      resolve(res.statusCode ?? 0);
    });
    r.on('error', reject);
    r.end();
  });

  if (statusCode === 200) return true;
  if (statusCode === 404) return false;

  // 401 on a public registry means the package exists but auth is required to see it
  if (statusCode === 401) return true;

  throw new Error(`Registry check for "${name}" returned unexpected status ${statusCode}`);
}

// ── Tarball packing ───────────────────────────────────────────────────────

/** Pack the stub directory into a tarball Buffer using libnpmpack. */
export async function packStub(dir: string): Promise<Buffer> {
  return await libnpmpack(`file:${dir}`, { ignoreScripts: true });
}

// ── Publish spawn ─────────────────────────────────────────────────────────

export interface RunPublishOptions {
  pm: SupportedPM;
  tarballPath: string;
  cwd: string;
  registry?: string;
  /** Override process.env for testing; defaults to process.env */
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawns `npm publish <tarball>` or `pnpm publish <tarball> --no-git-checks`.
 * Returns the process exit code.
 */
export async function runPublish(opts: RunPublishOptions): Promise<number> {
  const { pm, tarballPath, cwd, registry, env } = opts;

  const args = ['publish', tarballPath];
  if (pm === 'pnpm') args.push('--no-git-checks');
  if (registry) args.push(`--registry=${registry}`);

  return new Promise((resolve, reject) => {
    const child = spawn(pm, args, {
      cwd,
      stdio: 'inherit',
      env: env ?? process.env,
    });
    child.on('exit', code => resolve(code ?? 1));
    child.on('error', reject);
  });
}
