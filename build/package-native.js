/** Archive a tested host binary with version metadata, licenses and a checksum. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, 'dist/native')
const info = JSON.parse(readFileSync(path.join(output, 'build-info.json')))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json')))
if (
  info.version !== pkg.version ||
  info.platform !== process.platform ||
  info.arch !== process.arch
) {
  throw new Error('Native build metadata does not match this package and host')
}
const name = `${pkg.name}-${pkg.version}-${info.platform}-${info.arch}.tar.gz`
const archive = path.join(output, name)
const temporary = mkdtempSync(path.join(tmpdir(), 'carta1-package-'))
try {
  for (const [source, target] of [
    ['dist/native/carta1', 'carta1'],
    ['dist/native/build-info.json', 'build-info.json'],
    ['LICENSE', 'LICENSE'],
    ['native/PORFFOR-LICENSE', 'PORFFOR-LICENSE'],
    ['docs/native.md', 'README.md'],
  ])
    cpSync(path.join(root, source), path.join(temporary, target))
  execFileSync('tar', ['-czf', archive, '-C', temporary, '.'])
  const digest = createHash('sha256')
    .update(readFileSync(archive))
    .digest('hex')
  writeFileSync(`${archive}.sha256`, `${digest}  ${name}\n`)
  console.log(`Packaged ${archive}`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
