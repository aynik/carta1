/** Install the pinned, checksum-verified build tool into an explicit directory. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const destination = process.argv[2]
if (!destination)
  throw new Error(
    'Usage: node build/install-porffor.js <installation-directory>'
  )
const toolchain = JSON.parse(
  readFileSync(new URL('./porffor/toolchain.json', import.meta.url))
)
const target = `${process.platform}-${process.arch}`
const expected = toolchain.assets[target]
if (!expected) throw new Error(`Unsupported native target: ${target}`)
const asset = `porffor-${target}.tar.gz`
const response = await fetch(
  `https://github.com/CanadaHonk/porffor/releases/download/${toolchain.release}/${asset}`
)
if (!response.ok)
  throw new Error(`Porffor download failed: HTTP ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
if (createHash('sha256').update(bytes).digest('hex') !== expected)
  throw new Error('Porffor archive checksum mismatch')
const temporary = mkdtempSync(path.join(tmpdir(), 'carta1-toolchain-'))
try {
  const archive = path.join(temporary, asset)
  writeFileSync(archive, bytes)
  mkdirSync(destination, { recursive: true })
  execFileSync('tar', ['-xzf', archive, '-C', destination, 'porf'])
  chmodSync(path.join(destination, 'porf'), 0o755)
  console.log(`Installed ${path.resolve(destination, 'porf')}`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
