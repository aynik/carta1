/** Optional frame and native-host compatibility probe; never produces a release asset. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = mkdtempSync(path.join(tmpdir(), 'carta1-porffor-'))
const porffor = process.env.PORFFOR || 'porf'
console.log(`Porffor probe artifacts: ${output}`)

function run(name, executable, args) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  })
  writeFileSync(path.join(output, `${name}.stdout`), result.stdout || '')
  writeFileSync(path.join(output, `${name}.stderr`), result.stderr || '')
  return {
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

function compare(reference, actual) {
  const expected = reference.trim().split('\n').map(JSON.parse)
  const received = actual.trim().split('\n').map(JSON.parse)
  if (expected.length !== received.length) {
    throw new Error(`Expected ${expected.length} rows, got ${received.length}`)
  }
  const differences = { input: 0, bytes: 0, pcm: 0 }
  for (let row = 0; row < expected.length; row++) {
    for (const key of ['profile', 'signal', 'channels', 'frame', 'channel']) {
      if (expected[row][key] !== received[row][key]) {
        throw new Error(`Row ${row}: mismatched ${key}`)
      }
    }
    for (const key of Object.keys(differences)) {
      const a = expected[row][key]
      const b = received[row][key]
      if (!Array.isArray(b) || a.length !== b.length) {
        throw new Error(`Row ${row}: mismatched ${key} length`)
      }
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) differences[key]++
      }
    }
  }
  return {
    frames: expected.length,
    differences,
    exact: Object.values(differences).every((count) => count === 0),
    referenceSha256: createHash('sha256').update(reference).digest('hex'),
    nativeSha256: createHash('sha256').update(actual).digest('hex'),
  }
}

const version = run('version', porffor, ['--version'])
if (version.status !== 0) {
  throw new Error(
    `Cannot run Porffor (${porffor}): ${version.error || version.stderr}`
  )
}
const probe = path.join(root, 'build/porffor/frames.js')
const reference = run('node', process.execPath, [probe])
if (reference.status !== 0) throw new Error(reference.stderr)

// Porffor alpha 19 splits preference values on '='. A wrapper preserves the
// complete C flag and applies it to every translation unit and the linker.
const compiler = path.join(output, 'cc-strict')
writeFileSync(
  compiler,
  '#!/bin/sh\nexec "${CC:-cc}" -ffp-contract=off "$@"\n',
  {
    mode: 0o755,
  }
)
const report = {
  porffor: version.stdout.trim(),
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  compiler: run('compiler', process.env.CC || 'cc', [
    '--version',
  ]).stdout.trim(),
  packageVersion: JSON.parse(readFileSync(path.join(root, 'package.json')))
    .version,
  probes: {},
}

for (const name of ['default', 'strict']) {
  const binary = path.join(output, name)
  const args = ['native', probe, '-o', binary]
  if (name === 'strict') args.push(`--compiler=${compiler}`)
  const build = run(`${name}-build`, porffor, args)
  const entry = (report.probes[name] = { build })
  if (build.status === 0) {
    entry.binaryBytes = statSync(binary).size
    const execution = run(`${name}-run`, binary, [])
    // Large frame records remain in the .stdout file, outside the repository.
    entry.execution = { ...execution, stdout: undefined }
    if (execution.status === 0) {
      try {
        entry.comparison = compare(reference.stdout, execution.stdout)
      } catch (error) {
        entry.comparisonError = error.message
      }
    }
  }
  console.log(
    `${name} frame probe: ${JSON.stringify(entry.comparison || entry)}`
  )
}

const publicProbe = path.join(output, 'public.mjs')
writeFileSync(
  publicProbe,
  `import ${JSON.stringify(path.join(root, 'native/host.js'))}\n` +
    `import { encode, decode, serializeFrame, deserializeFrame } from ${JSON.stringify(path.join(root, 'codec/index.js'))}\n` +
    'console.log(String(decode()(deserializeFrame(serializeFrame(encode()(new Float32Array(512))))).length))\n'
)
for (const [name, source, args] of [
  ['public', publicProbe, []],
  ['cli', path.join(root, 'native/cli.js'), ['--help']],
]) {
  const binary = path.join(output, name)
  const build = run(`${name}-build`, porffor, [
    'native',
    source,
    '-o',
    binary,
    `--compiler=${compiler}`,
  ])
  const entry = (report.probes[name] = { build })
  if (build.status === 0) entry.execution = run(`${name}-run`, binary, args)
  console.log(`${name} probe: ${JSON.stringify(entry)}`)
}

report.compatible =
  report.probes.strict.comparison?.exact === true &&
  report.probes.public.execution?.status === 0 &&
  report.probes.public.execution?.stdout.trim() === '512' &&
  report.probes.cli.execution?.status === 0
writeFileSync(
  path.join(output, 'report.json'),
  JSON.stringify(report, null, 2) + '\n'
)
console.log(
  `Compatibility: ${report.compatible ? 'PASS' : 'BLOCKED'}; see ${output}/report.json`
)
process.exitCode = report.compatible ? 0 : 1
