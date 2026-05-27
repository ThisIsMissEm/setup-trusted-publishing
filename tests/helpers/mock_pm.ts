import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export interface MockPM {
  /** Prepend this to PATH when running the CLI under test */
  binDir: string
  /** Returns all recorded invocation arg arrays, in order */
  getCalls(): Promise<string[][]>
  /** Set the exit code the next (and subsequent) invocations will return */
  setExitCode(code: number): Promise<void>
  /** Set text to write to stderr on the next (and subsequent) invocations */
  setStderr(text: string): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

/**
 * Creates a fake npm or pnpm binary in a temp directory.
 *
 * The binary:
 *   - records process.argv.slice(2) as a JSON line to a calls file
 *   - exits with the code written to an exit-code file (default 0)
 *
 * Usage:
 *   await using pm = await createMockPM('npm');
 *   const result = spawnSync('node', ['...'], {
 *     env: { ...process.env, PATH: `${pm.binDir}:${process.env.PATH}` },
 *   });
 */
export async function createMockPM(pm: 'npm' | 'pnpm' = 'npm'): Promise<MockPM> {
  const dir = await mkdtemp(join(tmpdir(), 'mock-pm-'))
  const callsFile = join(dir, 'calls.ndjson')
  const exitCodeFile = join(dir, 'exit-code')
  const stderrFile = join(dir, 'stderr')

  // The mock script uses hardcoded absolute paths to avoid env var complexity.
  // Must use CJS require() — the script is written to a temp dir with no package.json
  // "type":"module", so Node treats it as CJS regardless of the .ts extension.
  const scriptContent = `#!/usr/bin/env node
const { appendFileSync, readFileSync, existsSync } = require('node:fs');

appendFileSync(
  ${JSON.stringify(callsFile)},
  JSON.stringify(process.argv.slice(2)) + '\\n',
  'utf8'
);

if (existsSync(${JSON.stringify(stderrFile)})) {
  process.stderr.write(readFileSync(${JSON.stringify(stderrFile)}, 'utf8'));
}

const exitCode = existsSync(${JSON.stringify(exitCodeFile)})
  ? parseInt(readFileSync(${JSON.stringify(exitCodeFile)}, 'utf8').trim(), 10)
  : 0;

process.exit(isNaN(exitCode) ? 0 : exitCode);
`

  await writeFile(join(dir, pm), scriptContent, { mode: 0o755 })

  return {
    binDir: dir,

    async getCalls(): Promise<string[][]> {
      try {
        const content = await readFile(callsFile, 'utf8')
        return content
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as string[])
      } catch {
        return []
      }
    },

    async setExitCode(code: number): Promise<void> {
      await writeFile(exitCodeFile, String(code), 'utf8')
    },

    async setStderr(text: string): Promise<void> {
      await writeFile(stderrFile, text, 'utf8')
    },

    async [Symbol.asyncDispose](): Promise<void> {
      await rm(dir, { recursive: true, force: true })
    },
  }
}
