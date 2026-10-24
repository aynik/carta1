/** Compile the public codec with a small Porffor/POSIX host, outside the source tree. */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const porffor = process.env.PORFFOR || 'porf'
const output = path.resolve(
  process.argv[2] || path.join(root, 'dist/native/carta1')
)
const toolchain = JSON.parse(
  readFileSync(new URL('./porffor/toolchain.json', import.meta.url))
)
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `${command} failed (${result.status}): ${result.stderr || ''}`
    )
  return (result.stdout || '').trim()
}
const compilerVersion = run(porffor, ['--version'])
if (compilerVersion !== toolchain.version)
  throw new Error(
    `Expected Porffor ${toolchain.version}; got ${compilerVersion}`
  )
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json')))
const temporary = mkdtempSync(path.join(tmpdir(), 'carta1-native-'))
try {
  for (const directory of ['codec', 'native'])
    cpSync(path.join(root, directory), path.join(temporary, directory), {
      recursive: true,
    })
  mkdirSync(path.join(temporary, 'bin'))
  cpSync(
    path.join(root, 'bin/options.js'),
    path.join(temporary, 'bin/options.js')
  )
  writeFileSync(
    path.join(temporary, 'native/version.js'),
    `export const version = ${JSON.stringify(pkg.version)}\n`
  )
  const wrapper = path.join(temporary, 'cc-strict')
  writeFileSync(
    wrapper,
    '#!/bin/sh\nexec "${CC:-cc}" -fno-fast-math -ffp-contract=off "$@"\n',
    { mode: 0o755 }
  )
  const binary = path.join(temporary, 'carta1')
  run(
    porffor,
    [
      'native',
      path.join(temporary, 'native/cli.js'),
      '-o',
      binary,
      `--compiler=${wrapper}`,
      '-j2',
    ],
    { stdio: 'inherit' }
  )
  mkdirSync(path.dirname(output), { recursive: true })
  cpSync(binary, output)
  const info = {
    version: pkg.version,
    porffor: compilerVersion,
    compiler: run(process.env.CC || 'cc', ['--version']),
    flags: ['-fno-fast-math', '-ffp-contract=off'],
    platform: process.platform,
    arch: process.arch,
  }
  writeFileSync(
    path.join(path.dirname(output), 'build-info.json'),
    JSON.stringify(info, null, 2) + '\n'
  )
  console.log(`Built ${output}`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
