/** Compare the actual executable with the Node CLI, including file containers. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { AeaFile } from '../codec/index.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const binary = path.resolve(
  process.env.CARTA1_NATIVE_BINARY || path.join(root, 'dist/native/carta1')
)
const directory = mkdtempSync(path.join(tmpdir(), 'carta1-native-parity-'))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json')))
const rows = []
let passed = false
for (const host of ['node', 'native']) mkdirSync(path.join(directory, host))

function run(host, args, success = true) {
  const result = spawnSync(
    host === 'node' ? process.execPath : binary,
    host === 'node' ? [path.join(root, 'bin/cli.js'), ...args] : args,
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
  )
  assert.ifError(result.error)
  assert.equal(result.signal, null, `${host}: ${result.stderr}`)
  if (success)
    assert.equal(
      result.status,
      0,
      `${host} ${args.join(' ')}: ${result.stderr}`
    )
  else
    assert.notEqual(
      result.status,
      0,
      `${host} unexpectedly accepted ${args.join(' ')}`
    )
  return result
}

function wave(channels, bits, samples) {
  const stride = (channels * bits) / 8
  const bytes = Buffer.alloc(44 + samples * stride)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(channels, 22)
  bytes.writeUInt32LE(44100, 24)
  bytes.writeUInt32LE(44100 * stride, 28)
  bytes.writeUInt16LE(stride, 32)
  bytes.writeUInt16LE(bits, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(bytes.length - 44, 40)
  let seed = 12345
  for (let offset = 44; offset < bytes.length; offset += bits / 8) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const sample = (seed | 0) >> (32 - bits)
    bytes.writeIntLE(sample, offset, bits / 8)
  }
  return bytes
}

function equalFiles(a, b) {
  const expected = readFileSync(a)
  const actual = readFileSync(b)
  assert.ok(expected.equals(actual), `${a} differs from ${b}`)
  return createHash('sha256').update(actual).digest('hex')
}

function compareCase(name, input, options = [], samples) {
  const nodeAea = path.join(directory, 'node', `${name}.aea`)
  const nativeAea = path.join(directory, 'native', `${name}.aea`)
  run('node', ['-eq', ...options, input, nodeAea])
  run('native', ['-eq', ...options, input, nativeAea])
  const encodedSha256 = equalFiles(nodeAea, nativeAea)
  const metadata = AeaFile.parseHeader(
    new Uint8Array(readFileSync(nativeAea).subarray(0, 2048))
  )
  if (samples !== undefined) assert.equal(metadata.sampleCount, samples)
  // Cross-decode each other's AEA rather than only testing self round trips.
  const nodeWave = path.join(directory, 'node', `${name}.wav`)
  const nativeWave = path.join(directory, 'native', `${name}.wav`)
  run('node', ['-dq', nativeAea, nodeWave])
  run('native', ['-dq', nodeAea, nativeWave])
  const decodedSha256 = equalFiles(nodeWave, nativeWave)
  if (samples !== undefined)
    assert.equal(
      readFileSync(nativeWave).length,
      44 + samples * metadata.channelCount * 2
    )
  rows.push({ name, encodedSha256, decodedSha256 })
  return { nodeAea, nativeAea }
}

test('native WAV/AEA and CLI parity', { timeout: 240_000 }, () => {
  assert.equal(run('native', ['--version']).stdout.trim(), pkg.version)
  assert.match(run('native', ['--help']).stdout, /--encode/)
  try {
    for (const channels of [1, 2]) {
      for (const bits of [16, 24, 32]) {
        for (const samples of [1, 512, 1041]) {
          const name = `${channels}ch-${bits}bit-${samples}`
          const input = path.join(directory, `${name}-日本🎵.wav`)
          writeFileSync(input, wave(channels, bits, samples))
          for (const [profile, options] of [
            ['auto', []],
            ['long', ['--modes', '0,0,0', '--bias', '0.75']],
            [
              'short',
              ['--modes=2,2,3', '--bias=1.25', '--title', '日本🎵 title'],
            ],
          ])
            compareCase(`${name}-${profile}`, input, options, samples)
        }
      }
    }
    // Empty input has no flush frame; nonempty partial input has one.
    const empty = path.join(directory, 'empty.wav')
    writeFileSync(empty, wave(1, 16, 0))
    compareCase('empty', empty, [], 0)
    const input = path.join(directory, '1ch-16bit-1041-日本🎵.wav')
    const { nodeAea } = compareCase(
      'unicode',
      input,
      ['-t', '日本🎵', '-m2,0,3'],
      1041
    )
    // Cross the compiler runtime's GC threshold; tiny fixtures did not expose
    // its async-generator queue failure on real audio files.
    const longInput = path.join(directory, 'long.wav')
    writeFileSync(longInput, wave(2, 16, 44100 * 20))
    compareCase(
      'long',
      longInput,
      ['--title', 'long native parity'],
      44100 * 20
    )
    compareCase('bom-title', input, ['--title', '\ufeff日本🎵'], 1041)
    const jsonPaths = ['node', 'native'].map((host) =>
      path.join(directory, `${host}.json`)
    )
    for (const [index, host] of ['node', 'native'].entries())
      run(host, ['-jq', nodeAea, jsonPaths[index]])
    assert.deepEqual(
      JSON.parse(readFileSync(jsonPaths[0])),
      JSON.parse(readFileSync(jsonPaths[1]))
    )
    for (const host of ['node', 'native']) {
      const output = path.join(directory, `${host}-preserve.aea`)
      writeFileSync(output, 'do not overwrite')
      run(host, ['-eq', input, output], false)
      assert.equal(readFileSync(output, 'utf8'), 'do not overwrite')
      run(host, ['-eqf', input, output])
      for (const options of [
        [],
        ['-e', '-d'],
        ['-e', '-m', '2,7,3'],
        ['-e', '-b', '6'],
        ['-e', '-t', 'é'.repeat(128)],
        ['--unknown'],
      ]) {
        run(
          host,
          [...options, input, path.join(directory, 'invalid.aea')],
          false
        )
      }
      run(
        host,
        [
          '-eq',
          path.join(directory, 'missing.wav'),
          path.join(directory, 'missing.aea'),
        ],
        false
      )
      for (const invalid of [
        Buffer.alloc(12),
        Buffer.alloc(2048),
        readFileSync(nodeAea).subarray(0, 2048),
      ]) {
        const corrupt = path.join(directory, `${host}-corrupt.aea`)
        writeFileSync(corrupt, invalid)
        run(host, ['-dq', corrupt, path.join(directory, 'invalid.wav')], false)
      }
    }
    for (const input of (process.env.CARTA1_NATIVE_CORPUS || '')
      .split(path.delimiter)
      .filter(Boolean)) {
      compareCase(path.basename(input, '.wav'), input, [
        '--title',
        'corpus parity',
      ])
    }
    console.log(`Exact WAV/AEA parity: ${rows.length} cases`)
    passed = true
  } finally {
    writeFileSync(
      path.join(directory, 'parity.json'),
      JSON.stringify(rows, null, 2) + '\n'
    )
    console.log(`Native parity evidence: ${directory}`)
    // Keep evidence on failure, or when explicitly requested for corpus work.
    if (passed && !process.env.CARTA1_KEEP_NATIVE_EVIDENCE)
      rmSync(directory, { recursive: true, force: true })
  }
})
