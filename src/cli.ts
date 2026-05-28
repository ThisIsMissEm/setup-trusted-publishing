import { parseArgs } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import validate from 'validate-npm-package-name'
import { readPackage, writePackageFields } from './packument.ts'
import { resolveAccess, AccessConflictError } from './access.ts'
import { buildStubManifest, writeStubDir, verifyStubDir } from './stub.ts'
import { detectPackageManager, packageExists, packStub, runPublish } from './registry.ts'

export interface MainOptions {
  argv?: string[]
  log?: (msg: string) => void
  err?: (msg: string) => void
  /** Override process.env for testing */
  env?: NodeJS.ProcessEnv
}

/** Exported for testing. */
export function formatSuccessUrl(name: string, effectiveRegistry: string): string {
  let hostname = ''
  try {
    hostname = new URL(effectiveRegistry).hostname
  } catch {
    /* */
  }

  if (hostname === 'registry.npmjs.org') {
    const urlSafeName = name.startsWith('@') ? `@${name.slice(1).replace('/', '%2F')}` : name
    return `Published ${name}@0.0.0 → https://www.npmjs.com/package/${urlSafeName}`
  }
  return `Published ${name}@0.0.0 to ${effectiveRegistry}`
}

/** Exported for testing. */
export function detectRepositoryUrl(cwd: string): string | null {
  let remote: string
  try {
    remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' }).trim()
  } catch {
    return null
  }

  // SSH → HTTPS: git@github.com:user/repo.git → https://github.com/user/repo
  remote = remote.replace(/^git@([^:]+):(.+)$/, 'https://$1/$2')
  // Strip git+https:// prefix
  remote = remote.replace(/^git\+/, '')
  // Strip trailing .git
  remote = remote.replace(/\.git$/, '')

  try {
    const url = new URL(remote)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return null
  }
}

function logPostPublishHints(
  log: (msg: string) => void,
  pkg: import('./packument.ts').PackageJson,
  detectedRepository: string | null
): void {
  log('')

  const missingMeta = (['repository', 'homepage', 'bugs'] as const).filter((f) => {
    if (f === 'repository' && detectedRepository) return false
    return !pkg[f]
  })
  if (missingMeta.length > 0) {
    log(
      `hint: add ${missingMeta.map((f) => `"${f}"`).join(', ')} to package.json — ` +
        `npm uses these for package discovery`
    )
  }

  log(
    `hint: the repository URL in package.json is case-sensitive for provenance and trusted publishing,\n      verify it exactly matches your GitHub (or other host) URL`
  )
}

// mkdtempDisposable was added in Node.js v24 and is absent from Bun — roll our own.
async function makeTempDir(prefix: string): Promise<{ path: string } & AsyncDisposable> {
  const tmpPath = await fs.mkdtemp(prefix)
  return {
    path: tmpPath,
    async [Symbol.asyncDispose]() {
      await fs.rm(tmpPath, { recursive: true, force: true })
    },
  }
}

export default async function main(opts: MainOptions = {}): Promise<number> {
  const argv = opts.argv ?? process.argv.slice(2)
  const log = opts.log ?? ((msg: string) => console.log(msg))
  const err = opts.err ?? ((msg: string) => console.error(msg))
  const env = opts.env ?? process.env

  // ── Step 1: Parse args ──────────────────────────────────────────────────

  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        'dry-run': { type: 'boolean', short: 'n', default: false },
        'no-publish': { type: 'boolean', default: false },
        'access': { type: 'string' },
        'force': { type: 'boolean', short: 'f', default: false },
        'registry': { type: 'string' },
        'cwd': { type: 'string', short: 'C' },
        'help': { type: 'boolean', short: 'h', default: false },
      },
    })
  } catch (e) {
    err((e as Error).message)
    return 2
  }

  const args = parsed.values

  if (args['help']) {
    log(`setup-trusted-publishing [options]

  -n, --dry-run        Build the stub but do not publish or write the source
      --no-publish     Write source package.json, pack the stub, copy tarball to
                       --cwd — but do not publish (for unsupported package managers)
      --access <mode>  'public' or 'restricted'
  -f, --force          Bypass access conflict errors and re-run even if package exists
      --registry <url> Registry to check and publish to
  -C, --cwd <path>     Source package directory (default: cwd)
  -h, --help`)
    return 0
  }

  const dryRun = args['dry-run'] as boolean
  const noPublish = args['no-publish'] as boolean
  const force = args['force'] as boolean
  const cwd = (args['cwd'] as string | undefined) ?? process.cwd()
  const registry = args['registry'] as string | undefined
  const flagAccess = args['access'] as string | undefined

  // Validate flag combinations
  if (dryRun && noPublish) {
    err('--dry-run and --no-publish cannot be used together')
    return 2
  }

  if (flagAccess !== undefined && flagAccess !== 'public' && flagAccess !== 'restricted') {
    err(`Invalid --access value: "${flagAccess}". Must be "public" or "restricted".`)
    return 2
  }

  const typedFlagAccess = flagAccess as 'public' | 'restricted' | undefined

  // ── Step 2: Read package.json ───────────────────────────────────────────

  let pkgResult: Awaited<ReturnType<typeof readPackage>>
  try {
    pkgResult = await readPackage(cwd)
  } catch (e) {
    err(`Failed to read package.json: ${(e as Error).message}`)
    return 1
  }

  // ── Step 3: Validate package name ───────────────────────────────────────

  const name = pkgResult.parsed.name
  if (!name) {
    err('package.json is missing the required "name" field')
    return 1
  }
  const validation = validate(name)
  if (!validation.validForNewPackages) {
    const reasons = [...(validation.errors ?? []), ...(validation.warnings ?? [])]
    err(`Invalid package name "${name}": ${reasons.join(', ')}`)
    return 1
  }

  // ── Step 4: Detect package manager ─────────────────────────────────────

  const pmDetection = detectPackageManager(
    pkgResult.parsed.packageManager,
    env['npm_config_user_agent']
  )

  if (!noPublish && !dryRun && pmDetection.pm === null) {
    const ua = env['npm_config_user_agent']
    err(
      `Unsupported package manager: ${pmDetection.unsupported}` +
        (ua ? ` (user-agent: ${ua})` : '') +
        `. Use --no-publish to prepare the stub tarball and publish it manually.`
    )
    return 1
  }

  // ── Step 5: Registry existence check ────────────────────────────────────

  let exists: boolean
  try {
    exists = await packageExists(name, { registry })
  } catch (e) {
    err(`Registry check failed: ${(e as Error).message}`)
    return 1
  }

  if (exists && !force) {
    log(`${name} is already published — nothing to do.`)
    return 0
  }

  // ── Step 5b: Require explicit --access for scoped packages with no existing setting ──

  if (
    name.startsWith('@') &&
    !pkgResult.parsed.private &&
    !pkgResult.parsed.publishConfig?.access &&
    !typedFlagAccess
  ) {
    err(
      `Scoped package ${name} defaults to restricted (private) access on npm.\n` +
        `Pass --access public or --access restricted to set the access level explicitly.`
    )
    return 2
  }

  // ── Step 6: Resolve access ──────────────────────────────────────────────

  let accessResolution: ReturnType<typeof resolveAccess>
  try {
    accessResolution = resolveAccess({
      isPrivate: pkgResult.parsed.private,
      existingAccess: pkgResult.parsed.publishConfig?.access,
      flagAccess: typedFlagAccess,
      force,
    })
  } catch (e) {
    if (e instanceof AccessConflictError) {
      err(e.message)
      return 2
    }
    throw e
  }

  // ── Step 7: Write publishConfig updates + repository to source (unless dry-run) ──

  const needsProvenance = !pkgResult.parsed.publishConfig?.provenance

  let detectedRepository: string | null = null
  if (!pkgResult.parsed.repository) {
    detectedRepository = detectRepositoryUrl(cwd)
  }

  if (!dryRun) {
    const pkgUpdates: Parameters<typeof writePackageFields>[2] = {}
    if (accessResolution.changed || needsProvenance) {
      const publishConfigUpdates: Record<string, unknown> = {}
      if (accessResolution.changed) publishConfigUpdates['access'] = accessResolution.value
      if (needsProvenance) publishConfigUpdates['provenance'] = true
      pkgUpdates.publishConfig = publishConfigUpdates
    }
    if (detectedRepository) pkgUpdates.repository = detectedRepository
    if (Object.keys(pkgUpdates).length > 0) {
      await writePackageFields(cwd, pkgResult, pkgUpdates)
    }
  }

  // ── Step 8: Build stub manifest ─────────────────────────────────────────

  // Use the updated values so buildStubManifest sees the resolved publishConfig
  const updatedPkg = {
    ...pkgResult.parsed,
    publishConfig: {
      ...pkgResult.parsed.publishConfig,
      ...(accessResolution.changed ? { access: accessResolution.value } : {}),
      ...(needsProvenance ? { provenance: true } : {}),
    },
    ...(detectedRepository ? { repository: detectedRepository } : {}),
  }

  const stubManifest = buildStubManifest(updatedPkg, accessResolution.value)

  // ── Step 9: dry-run exit ─────────────────────────────────────────────────

  if (dryRun) {
    log('Stub manifest (dry run):')
    log(JSON.stringify(stubManifest, null, 2))
    return 0
  }

  // ── Steps 10–17: Pack and publish ────────────────────────────────────────

  const tarballName = `${name.replace(/^@/, '').replace(/\//g, '-')}-0.0.0.tgz`

  await using tempDir = await makeTempDir(join(tmpdir(), 'setup-tp-'))
  const tempPath: string = tempDir.path

  // Step 11: Write stub files
  await writeStubDir(tempPath, stubManifest)

  // Step 12: Verify contents
  try {
    await verifyStubDir(tempPath)
  } catch (e) {
    err((e as Error).message)
    return 1
  }

  // Step 13: Pack
  const tarBuf = await packStub(tempPath)
  const tarballPath = join(tempPath, tarballName)
  await fs.writeFile(tarballPath, tarBuf)

  // Step 14: --no-publish
  if (noPublish) {
    const dest = join(cwd, tarballName)
    await fs.copyFile(tarballPath, dest)
    log(`Stub packed to ./${tarballName}\n`)
    log(`Run your publish command to complete the initial publish, e.g.:`)
    log(`  yarn npm publish ./${tarballName}`)
    logPostPublishHints(log, pkgResult.parsed, detectedRepository)
    return 0
  }

  // Step 15: Spawn publish
  const pm = pmDetection.pm!
  const result = await runPublish({ pm, tarballPath, cwd, registry, env })
  if (result.exitCode !== 0) {
    if (result.looksLikeAuthError) {
      err(
        'hint: 404 on publish usually means missing auth — set NPM_TOKEN or run `npm login` / `pnpm login`'
      )
    }
    return result.exitCode
  }

  // Step 16: Success output
  const effectiveRegistry = registry ?? env['NPM_CONFIG_REGISTRY'] ?? 'https://registry.npmjs.org/'
  log(formatSuccessUrl(name, effectiveRegistry))
  logPostPublishHints(log, pkgResult.parsed, detectedRepository)

  return 0
  // Step 17: temp dir auto-cleans via await using
}
