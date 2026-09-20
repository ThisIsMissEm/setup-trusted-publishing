import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { toCmdString } from '../src/registry.ts' // adjust the path to your layout

const UNSAFE = /Unsafe argument for cmd\.exe/

describe('toCmdString', () => {
  it('leaves simple arguments unquoted', () => {
    assert.equal(
      toCmdString('pnpm', ['publish', 'pkg-0.0.0.tgz', '--no-git-checks']),
      'pnpm publish pkg-0.0.0.tgz --no-git-checks'
    )
  })

  it('returns just the command when there are no arguments', () => {
    assert.equal(toCmdString('npm', []), 'npm')
  })

  it('leaves registry flags and scoped package names unquoted', () => {
    assert.equal(
      toCmdString('npm', ['publish', '--registry=https://registry.npmjs.org/', '@scope/pkg']),
      'npm publish --registry=https://registry.npmjs.org/ @scope/pkg'
    )
  })

  it('quotes Windows paths with backslashes', () => {
    assert.equal(
      toCmdString('npm', ['publish', 'C:\\Users\\dev\\AppData\\Local\\Temp\\x.tgz']),
      'npm publish "C:\\Users\\dev\\AppData\\Local\\Temp\\x.tgz"'
    )
  })

  it('quotes paths with spaces', () => {
    assert.equal(
      toCmdString('npm', ['publish', 'C:\\Program Files\\tmp\\x.tgz']),
      'npm publish "C:\\Program Files\\tmp\\x.tgz"'
    )
  })

  it('quotes paths with non-ASCII characters', () => {
    assert.equal(
      toCmdString('npm', ['publish', 'C:\\Users\\José\\x.tgz']),
      'npm publish "C:\\Users\\José\\x.tgz"'
    )
  })

  it('quotes cmd.exe metacharacters so they stay literal', () => {
    for (const arg of ['a&b', 'a|b', 'a<b', 'a>b', 'a^b', '(a)', 'a b']) {
      assert.equal(toCmdString('npm', [arg]), `npm "${arg}"`, `arg: ${arg}`)
    }
  })

  it('quotes an empty argument', () => {
    assert.equal(toCmdString('npm', ['']), 'npm ""')
  })

  it('rejects double quotes', () => {
    assert.throws(() => toCmdString('npm', ['a"b']), UNSAFE)
  })

  it('rejects percent signs (cmd.exe variable expansion)', () => {
    assert.throws(() => toCmdString('npm', ['%PATH%']), UNSAFE)
  })

  it('rejects line breaks', () => {
    assert.throws(() => toCmdString('npm', ['a\nb']), UNSAFE)
    assert.throws(() => toCmdString('npm', ['a\rb']), UNSAFE)
  })

  it('applies the same validation to the command itself', () => {
    assert.throws(() => toCmdString('pnpm" & calc & "', ['publish']), UNSAFE)
  })
})

describe('toCmdString on Windows', { skip: process.platform !== 'win32' }, () => {
  it('delivers every argument intact through a real cmd.exe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cmd quote ñ '))
    try {
      const script = join(dir, 'echo-argv.mjs')
      await writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')

      const forwarded = [
        'C:\\Program Files\\José\\a b.tgz',
        'a&b',
        'a|b',
        '--registry=https://registry.npmjs.org/',
      ]

      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(toCmdString('node', [script, ...forwarded]), {
          shell: true,
          stdio: ['ignore', 'pipe', 'inherit'],
        })
        let out = ''
        child.stdout!.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8')
        })
        child.on('error', reject)
        child.on('exit', (code) =>
          code === 0 ? resolve(out) : reject(new Error(`exit code ${code}`))
        )
      })

      assert.deepEqual(JSON.parse(stdout), forwarded)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
