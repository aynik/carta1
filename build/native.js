/** Build-only Porffor adapters. Nothing generated here enters the npm tree. */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { transformSync, types as t } from '@babel/core'

const configuration = process.env.NATIVE_BUILD
if (!configuration) throw new Error('Expected NATIVE_BUILD JSON configuration')
const codec = JSON.parse(configuration)
const root = path.resolve(codec.root || '.')
const constants = await import(
  pathToFileURL(path.resolve(root, codec.constants)).href
)
const work = fs.mkdtempSync(path.join(os.tmpdir(), codec.name + '-aot-'))
const output = path.resolve(process.argv[2] || path.join(work, codec.name))
const porffor = process.env.PORFFOR || 'porf'

const resolvedOutput = fs.existsSync(output)
  ? fs.realpathSync(output)
  : path.join(fs.realpathSync(path.dirname(output)), path.basename(output))
const packageOutput = path.relative(fs.realpathSync(root), resolvedOutput)
if (
  !packageOutput.startsWith('..' + path.sep) &&
  !path.isAbsolute(packageOutput)
) {
  throw new Error('Native output must be outside the npm package directory')
}

// The host adapter below uses the memory layout of this pinned compiler release.
const compilerVersion = spawnSync(porffor, ['--help'], { encoding: 'utf8' })
if (compilerVersion.error) throw compilerVersion.error
if (!compilerVersion.stdout.includes('alpha 19 (0c135ce 2026-10-21)')) {
  throw new Error('This native adapter requires Porffor alpha-19 (0c135ce)')
}

/* global Porffor */
/* eslint-disable no-unused-vars -- Embedded C refers to local bindings. */

/** UTF-8 encoding for file metadata and native terminal output. */
class NativeTextEncoder {
  encode(input = '') {
    const source = String(input)
    const output = new Uint8Array(source.length * 3)
    return output.slice(0, this.encodeInto(source, output).written)
  }
  encodeInto(source, output) {
    let read = 0
    let written = 0
    while (read < source.length) {
      let point = source.charCodeAt(read)
      let units = 1
      if (point >= 0xd800 && point <= 0xdbff) {
        const next = source.charCodeAt(read + 1)
        if (next >= 0xdc00 && next <= 0xdfff) {
          point = 0x10000 + (point - 0xd800) * 1024 + next - 0xdc00
          units = 2
        } else point = 0xfffd
      } else if (point >= 0xdc00 && point <= 0xdfff) point = 0xfffd
      const size = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4
      if (written + size > output.length) break
      if (size === 1) output[written++] = point
      else {
        output[written++] =
          size === 2
            ? 0xc0 | (point >> 6)
            : size === 3
              ? 0xe0 | (point >> 12)
              : 0xf0 | (point >> 18)
        if (size === 4) output[written++] = 0x80 | ((point >> 12) & 63)
        if (size >= 3) output[written++] = 0x80 | ((point >> 6) & 63)
        output[written++] = 0x80 | (point & 63)
      }
      read += units
    }
    return {
      read,
      written,
    }
  }
}

/** Decode UTF-8 with replacement characters for malformed byte sequences. */
class NativeTextDecoder {
  constructor(label = 'utf-8', options = {}) {
    this.ignoreBOM = Boolean(options.ignoreBOM)
  }
  decode(bytes) {
    let output = ''
    let offset = 0
    let first = true
    while (offset < bytes.length) {
      const lead = bytes[offset++]
      let point = lead
      let count = 0
      let lower = 128
      let upper = 191
      if (lead >= 194 && lead <= 223) {
        point = lead & 31
        count = 1
      } else if (lead >= 224 && lead <= 239) {
        point = lead & 15
        count = 2
        if (lead === 224) lower = 160
        if (lead === 237) upper = 159
      } else if (lead >= 240 && lead <= 244) {
        point = lead & 7
        count = 3
        if (lead === 240) lower = 144
        if (lead === 244) upper = 143
      } else if (lead >= 128) point = 0xfffd
      for (let index = 0; index < count; index++) {
        const byte = bytes[offset]
        if (offset === bytes.length || byte < lower || byte > upper) {
          point = 0xfffd
          break
        }
        offset++
        point = (point << 6) | (byte & 63)
        lower = 128
        upper = 191
      }
      if (!(first && point === 0xfeff && !this.ignoreBOM))
        output += String.fromCodePoint(point)
      first = false
    }
    return output
  }
}

/** The Buffer operations used by streaming command-line applications. */
class NativeBuffer extends Uint8Array {
  static alloc(length) {
    return new NativeBuffer(length)
  }
  static from(value) {
    return new NativeBuffer(
      typeof value === 'string' ? new NativeTextEncoder().encode(value) : value
    )
  }
  static concat(parts) {
    const result = new NativeBuffer(parts.reduce((n, b) => n + b.length, 0))
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.length
    }
    return result
  }
  readUInt16LE(i) {
    return this[i] | (this[i + 1] << 8)
  }
  readUInt32LE(i) {
    return (
      (this[i] |
        (this[i + 1] << 8) |
        (this[i + 2] << 16) |
        (this[i + 3] << 24)) >>>
      0
    )
  }
  readInt16LE(i) {
    return ((this[i] | (this[i + 1] << 8)) << 16) >> 16
  }
  readInt32LE(i) {
    return (
      this[i] | (this[i + 1] << 8) | (this[i + 2] << 16) | (this[i + 3] << 24)
    )
  }
  static decode(buffer, encoding = 'utf8', start = 0, end = buffer.length) {
    return new NativeTextDecoder().decode(buffer.subarray(start, end))
  }
}

/** Encode a NUL-terminated UTF-8 filesystem path. */
function encodeNativePath(value) {
  if (value.includes('\0')) throw new Error('Invalid NUL in path')
  const bytes = new NativeTextEncoder().encode(value)
  const out = new Uint8Array(bytes.length + 1)
  out.set(bytes)
  return out
}

/** Open a buffered C file and expose the FileHandle methods used by the CLI. */
function openNativeFile(filename, mode) {
  const filenameBytes = encodeNativePath(filename)
  const modeBytes = encodeNativePath(
    mode === 'r' ? 'rb' : mode === 'wx' ? 'wbx' : 'wb'
  )
  const filenamePointer = Porffor.IR.ptr(filenameBytes.buffer)
  const modePointer = Porffor.IR.ptr(modeBytes.buffer)
  let handle = 0
  Porffor.c`
    FILE *stream = fopen(
      (char*)MEM + (u32)filenamePointer.val + 8,
      (char*)MEM + (u32)modePointer.val + 8
    );
    handle = (f64)(uintptr_t)stream;
  `
  if (!handle) {
    const error = new Error('Cannot open file: ' + filename)
    error.path = filename
    throw error
  }
  return {
    handle,
    read: readNativeFile,
    write: writeNativeFile,
    stat: statNativeFile,
    close: closeNativeFile,
  }
}

/** Read one bounded block into an existing buffer at the requested file position. */
function readNativeFile(buffer, offset, length, position) {
  const handle = this.handle
  const pointer = Porffor.IR.ptr(buffer.buffer)
  const start = buffer.byteOffset
  let seek = 0
  if (position !== null && position !== undefined) seek = 1
  let count = 0
  Porffor.c`
    FILE *stream = (FILE*)(uintptr_t)handle.val;
    if (seek) fseeko(stream, (off_t)position.val, SEEK_SET);
    count = fread(
      MEM + (u32)pointer.val + 8 + (u32)start.val + (u32)offset.val,
      1, (size_t)length.val, stream
    );
  `
  return {
    bytesRead: count,
  }
}

/** Write one byte block, returning the actual number of bytes written. */
function writeNativeFile(
  buffer,
  offset = 0,
  length = buffer.length,
  position = null
) {
  const handle = this.handle
  const pointer = Porffor.IR.ptr(buffer.buffer)
  const start = buffer.byteOffset
  let seek = 0
  if (position !== null && position !== undefined) seek = 1
  let count = 0
  Porffor.c`
    FILE *stream = (FILE*)(uintptr_t)handle.val;
    if (seek) fseeko(stream, (off_t)position.val, SEEK_SET);
    count = fwrite(
      MEM + (u32)pointer.val + 8 + (u32)start.val + (u32)offset.val,
      1, (size_t)length.val, stream
    );
  `
  return {
    bytesWritten: count,
  }
}

/** Measure an open file without changing its read/write position. */
function statNativeFile() {
  const handle = this.handle
  let size = 0
  Porffor.c`
    FILE *stream = (FILE*)(uintptr_t)handle.val;
    off_t old = ftello(stream);
    fseeko(stream, 0, SEEK_END);
    size = ftello(stream);
    fseeko(stream, old, SEEK_SET);
  `
  return {
    size,
  }
}

/** Release an open native file handle. */
function closeNativeFile() {
  const handle = this.handle
  Porffor.c`
    fclose((FILE*)(uintptr_t)handle.val);
  `
}

/** Read filesystem metadata through a temporary file handle. */
function statNativePath(filename) {
  const file = openNativeFile(filename, 'r')
  try {
    return file.stat()
  } finally {
    file.close()
  }
}

/** Check whether a path can be opened without retaining a file handle. */
function nativePathExists(filename) {
  try {
    statNativePath(filename)
    return true
  } catch {
    return false
  }
}

/** Yield bounded file blocks without collecting the file. */
function* readNativeStream(filename, options = {}) {
  const file = openNativeFile(filename, 'r')
  const size = file.stat().size
  let position = options.start || 0
  try {
    while (position < size) {
      const bytes = NativeBuffer.alloc(Math.min(65536, size - position))
      const count = file.read(bytes, 0, bytes.length, position).bytesRead
      if (!count) throw new Error('Truncated input')
      position += count
      yield bytes.subarray(0, count)
    }
  } finally {
    file.close()
  }
}

/** Decode one command-line argument, preserving a leading Unicode BOM. */
function readNativeArgument(argIndex) {
  let length = 0
  Porffor.c`
    length = strlen(porf_argv[(int)argIndex.val]);
  `
  const bytes = new Uint8Array(length)
  const pointer = Porffor.IR.ptr(bytes.buffer)
  Porffor.c`
    memcpy(MEM + (u32)pointer.val + 8, porf_argv[(int)argIndex.val], (size_t)length);
  `
  return new NativeTextDecoder('utf-8', {
    ignoreBOM: true,
  }).decode(bytes)
}

/** Expose TTY detection and flushed writes for the shared progress display. */
function createNativeTerminal(fd) {
  let tty = 0
  Porffor.c`
    tty = isatty((int)fd);
  `
  return {
    fd,
    isTTY: tty !== 0,
    columns: 100,
    write(value) {
      const bytes = new NativeTextEncoder().encode(value)
      const pointer = Porffor.IR.ptr(bytes.buffer)
      const length = bytes.length
      const descriptor = this.fd
      Porffor.c`
        FILE *target = descriptor.val == 1 ? stdout : stderr;
        fwrite(MEM + (u32)pointer.val + 8, 1, (size_t)length.val, target);
        fflush(target);
      `
      return true
    },
  }
}

/** Terminate the compiled CLI with its original exit status. */
function exitNativeProcess(code) {
  Porffor.c`
    exit((int)code.val);
  `
}

/** Install build-only host bindings before loading the original CLI. */
function installNativeRuntime(argvPrefix) {
  let count = 0
  Porffor.c`
    count = porf_argc;
  `
  const argv = argvPrefix
  for (let index = 1; index < count; index++)
    argv.push(readNativeArgument(index))
  globalThis.TextEncoder = NativeTextEncoder
  globalThis.TextDecoder = NativeTextDecoder
  globalThis.Buffer = NativeBuffer
  globalThis.process = {
    argv,
    env: {},
    platform: 'posix',
    stdout: createNativeTerminal(1),
    stderr: createNativeTerminal(2),
    exit: exitNativeProcess,
  }
  globalThis.__nativeFs = {
    promises: {
      open: openNativeFile,
    },
    statSync: statNativePath,
    existsSync: nativePathExists,
    createReadStream: readNativeStream,
    realpathSync: (value) => value,
  }
}

/** Emit the small builtin-module adapters beside the temporary source tree. */
function prepareRuntime() {
  fs.mkdirSync(path.join(work, 'node_modules'))
  const definitions = [
    NativeTextEncoder,
    NativeTextDecoder,
    NativeBuffer,
    encodeNativePath,
    openNativeFile,
    readNativeFile,
    writeNativeFile,
    statNativeFile,
    closeNativeFile,
    statNativePath,
    nativePathExists,
    readNativeStream,
    readNativeArgument,
    createNativeTerminal,
    exitNativeProcess,
    ...nativeHelpers,
    installNativeRuntime,
  ]
  fs.writeFileSync(
    path.join(work, 'host.js'),
    definitions
      .map(
        (definition) =>
          (nativeHelpers.includes(definition) ? 'export ' : '') +
          (nativeIntrinsics.includes(definition)
            ? nativeNumericSource(definition)
            : definition.toString())
      )
      .join('\n\n') +
      '\ninstallNativeRuntime(' +
      JSON.stringify(codec.argv) +
      ')\n'
  )
  fs.writeFileSync(
    path.join(work, 'package.json'),
    JSON.stringify({ type: 'module' })
  )
  const aliases = {
    fs: 'module.exports = globalThis.__nativeFs',
    process: 'module.exports = globalThis.process',
    path: 'module.exports = (' + createNativePath.toString() + ')()',
  }
  for (const [name, source] of Object.entries(aliases)) {
    const directory = path.join(work, 'node_modules', name)
    fs.mkdirSync(directory)
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ main: 'index.cjs' })
    )
    fs.writeFileSync(path.join(directory, 'index.cjs'), source)
  }
}

/** Path operations used by command-line file handling. */
function createNativePath() {
  function basename(filename, extension = '') {
    const name = filename.slice(filename.lastIndexOf('/') + 1)
    return extension && name.endsWith(extension)
      ? name.slice(0, -extension.length)
      : name
  }
  function dirname(filename) {
    return filename.slice(0, filename.lastIndexOf('/')) || '.'
  }
  function extname(filename) {
    const name = basename(filename)
    const offset = name.lastIndexOf('.')
    return offset > 0 ? name.slice(offset) : ''
  }
  function resolve(...parts) {
    return parts.join('/')
  }
  return { basename, dirname, extname, resolve }
}

/**
 * Read a numeric element without boxing each arithmetic operand.
 * The low three kind bits select storage; bit 3 marks caller-proven bounds.
 * Checked reads return NaN for missing elements, matching numeric coercion.
 */
function readNativeNumber(array, sampleIndex, kind) {
  const pointer = Porffor.IR.ptr(array)
  let result = NaN
  Porffor.c`
    u32 view = (u32)pointer.val;
    f64 offset = sampleIndex;
    u32 element = (u32)kind;
    if (element >= 8 || (offset >= 0 && offset < *(i32*)(MEM + view) && offset == trunc(offset))) {
      u8 *data = MEM + *(u32*)(MEM + view + 4) + 4;
      switch (element & 7) {
        case 0:
          result = (f64)((f32*)data)[(u32)offset];
          break;
        case 1:
          result = ((f64*)data)[(u32)offset];
          break;
        case 2:
          result = (f64)((i32*)data)[(u32)offset];
          break;
        case 3:
          result = (f64)data[(u32)offset];
          break;
        case 4:
          result = (f64)((int16_t*)data)[(u32)offset];
          break;
      }
    }
  `
  return result
}

/** Store a numeric result with bounds checks and JavaScript integer conversion. */
function writeNativeNumber(array, sampleIndex, value, kind) {
  const pointer = Porffor.IR.ptr(array)
  Porffor.c`
    u32 view = (u32)pointer.val;
    f64 offset = sampleIndex;
    u32 element = (u32)kind;
    if (element >= 8 || (offset >= 0 && offset < *(i32*)(MEM + view) && offset == trunc(offset))) {
      u8 *data = MEM + *(u32*)(MEM + view + 4) + 4;
      element &= 7;
      if (element == 0) ((f32*)data)[(u32)offset] = value;
      else if (element == 1) ((f64*)data)[(u32)offset] = value;
      else {
        f64 integer = isfinite(value) ? trunc(value) : 0;
        if (element == 2 && integer >= -2147483648.0 && integer < 2147483648.0) {
          ((i32*)data)[(u32)offset] = (i32)integer;
        } else if (element == 3 && integer >= 0 && integer < 256) {
          data[(u32)offset] = (u8)integer;
        } else {
          f64 reduced = fmod(integer, 4294967296.0);
          if (reduced < 0) reduced += 4294967296.0;
          if (element == 2) ((u32*)data)[(u32)offset] = (u32)reduced;
          else data[(u32)offset] = (u8)(u32)reduced;
        }
      }
    }
  `
  return value
}

/** Porffor emits fmod even for bounded integer ring indices. */
function remainderNativeInteger(left, right) {
  let result = NaN
  Porffor.c`
    i32 dividend = (i32)left;
    i32 divisor = (i32)right;
    if (divisor != 0) {
      if (dividend == (-2147483647 - 1) && divisor == -1) result = -0.0;
      else {
        i32 remainder = dividend % divisor;
        result = remainder == 0 && dividend < 0 ? -0.0 : (f64)remainder;
      }
    }
  `
  return result
}

/** Bit masks use exact powers of two; avoid libm for bounded integer exponents. */
function powerNativeTwo(exponent) {
  let result = 0
  Porffor.c`
    if (exponent >= 0 && exponent <= 63 && exponent == trunc(exponent)) {
      result = (f64)(UINT64_C(1) << (u32)exponent);
    } else {
      result = pow(2.0, exponent);
    }
  `
  return result
}

/** Two-number Math.min, including NaN propagation and signed zero. */
function minimumNativeNumber(left, right) {
  let result = NaN
  Porffor.c`
    if (left == left && right == right) {
      result = left < right ? left : right;
      if (left == 0 && right == 0) {
        result = signbit(left) || signbit(right) ? -0.0 : 0.0;
      }
    }
  `
  return result
}

/** Two-number Math.max, including NaN propagation and signed zero. */
function maximumNativeNumber(left, right) {
  let result = NaN
  Porffor.c`
    if (left == left && right == right) {
      result = left > right ? left : right;
      if (left == 0 && right == 0) {
        result = signbit(left) && signbit(right) ? -0.0 : 0.0;
      }
    }
  `
  return result
}

/** Clear a complete typed-array view to positive zero. The return is unused. */
function clearNativeArray(array, kind) {
  const pointer = Porffor.IR.ptr(array)
  Porffor.c`
    u32 view = (u32)pointer.val;
    u32 element = (u32)kind;
    size_t width = element == 1 ? 8 : element == 3 ? 1 : element == 4 ? 2 : 4;
    u8 *data = MEM + *(u32*)(MEM + view + 4) + 4;
    memset(data, 0, (size_t)*(i32*)(MEM + view) * width);
  `
  return 0
}

const nativeIntrinsics = [
  readNativeNumber,
  writeNativeNumber,
  remainderNativeInteger,
  powerNativeTwo,
  minimumNativeNumber,
  maximumNativeNumber,
  clearNativeArray,
]
const nativeHelpers = nativeIntrinsics

/** Give the numeric intrinsic an unboxed signature in the native compiler. */
function nativeNumericSource(definition) {
  return transformSync(definition.toString(), {
    babelrc: false,
    configFile: false,
    plugins: [
      () => ({
        visitor: {
          Function(p) {
            for (const parameter of p.node.params.slice(
              [readNativeNumber, writeNativeNumber, clearNativeArray].includes(
                definition
              )
                ? 1
                : 0
            )) {
              parameter.typeAnnotation = t.tsTypeAnnotation(
                t.tsTypeReference(t.identifier('f64'))
              )
            }
            p.node.returnType = t.tsTypeAnnotation(
              t.tsTypeReference(t.identifier('f64'))
            )
          },
        },
      }),
    ],
  }).code
}

/** Array and scalar fields whose representation is explicit in codec source. */
const numericArrayFields = new Set()
const numericFields = new Set()
const integerFields = new Set()
const nonIntegerFields = new Set()
const arrayFields = new Map()
const arrayGlobals = new Map()
const matrixFields = new Map()
const objectFields = new Map()
const numericGlobals = new Set()
const integerGlobals = new Set()

/**
 * Read JSDoc tags, including custom types, nested records, and optional names.
 *
 * @param {object[]} comments - Babel comment nodes.
 * @returns {object[]} Parsed tags.
 */
function documentationTags(comments = []) {
  const text = comments.map((comment) => comment.value).join('\n')
  const tags = []
  const pattern =
    /@(param|returns?|type|typedef|property|nativeUnchecked)\b[ \t]*/g
  for (const match of text.matchAll(pattern)) {
    let cursor = match.index + match[0].length
    if (match[1] === 'nativeUnchecked') {
      tags.push({ kind: match[1] })
      continue
    }
    if (text[cursor] !== '{') continue
    cursor++
    const start = cursor
    let depth = 1
    while (cursor < text.length && depth > 0) {
      if (text[cursor] === '{') depth++
      if (text[cursor] === '}') depth--
      cursor++
    }
    if (depth !== 0) continue
    const name = text.slice(cursor).match(/^\s*(\[[^\]]+\]|[^\s*]+)/)?.[1]
    tags.push({
      kind: match[1] === 'return' ? 'returns' : match[1],
      type: text.slice(start, cursor - 1).trim(),
      name: name?.replace(/^\[|\]$/g, '').split('=')[0],
    })
  }
  return tags
}

/** @param {object} p - Babel node path. @returns {object[]} Its JSDoc tags. */
function documentedTags(p) {
  return documentationTags(
    p.node.leadingComments || p.parentPath?.node.leadingComments || []
  )
}

/**
 * Keep typedefs scoped to their source module, including record properties.
 *
 * @param {object} p - Babel program path.
 * @param {object} state - Babel file state.
 */
function collectDocumentedTypes(p, state) {
  const aliases = new Map()
  for (const comment of state.file.ast.comments || []) {
    const tags = documentationTags([comment])
    const definition = tags.find((tag) => tag.kind === 'typedef')
    if (!definition?.name) continue
    aliases.set(definition.name, {
      type: definition.type,
      fields: new Map(
        tags
          .filter((tag) => tag.kind === 'property')
          .map((tag) => [tag.name, tag.type])
      ),
    })
  }
  p.scope.nativeTypes = aliases
}

/** Resolve a local JSDoc typedef without changing its underlying JS type. */
function resolveDocumentedType(name, scope, visited = new Set()) {
  name = name.trim().replace(/Array\.</g, 'Array<')
  const definition = scope?.getProgramParent().nativeTypes?.get(name)
  if (!definition || definition.type === 'object' || visited.has(name))
    return name
  visited.add(name)
  return resolveDocumentedType(definition.type, scope, visited)
}

/** Record the scalar, array, and field types documented on a binding. */
function recordDocumentedBinding(binding, name) {
  name = resolveDocumentedType(name, binding.scope)
  const definition = binding.scope.getProgramParent().nativeTypes?.get(name)
  if (definition?.fields.size) {
    binding.nativeFields = definition.fields
  }
  if (/^(Float|Int|Uint)\d+Array\|null$/.test(name))
    binding.nativeNullableArrayType = name.split('|')[0]
  if (/^(Float|Int|Uint)\d+Array$/.test(name) || name === 'Buffer') {
    binding.nativeArrayType = name === 'Buffer' ? 'Uint8Array' : name
  }
  if (name === 'number' || name === 'f64') binding.nativeShape = 'number'
  if (name === 'i32') binding.nativeShape = 'integer'
  if (
    name === 'Array<number>' ||
    name === 'number[]' ||
    name.split('|').every((type) => /^(Float|Int|Uint)\d+Array$/.test(type))
  )
    binding.nativeShape = 'array'
  const rows = name.match(/^(?:Array<(\w+Array)>|(\w+Array)\[\])$/)
  if (rows) {
    binding.nativeShape = 'arrays'
    binding.nativeElementType = rows[1] || rows[2]
  }
}

/** Numeric return contract already declared by a function's JSDoc. */
function returnType(binding) {
  if (!binding) return null
  const tag = documentedTags(binding.path).find((tag) => tag.kind === 'returns')
  return tag ? resolveDocumentedType(tag.type, binding.scope) : null
}

/** Select element storage and honor explicit JSDoc access preconditions. */
function nativeElementKind(array, p) {
  const kind = [
    'Float32Array',
    'Float64Array',
    'Int32Array',
    'Uint8Array',
    'Int16Array',
  ].indexOf(array)
  if (kind === -1) return kind
  const owner = p.getFunctionParent()
  const unchecked =
    owner && documentedTags(owner).some((tag) => tag.kind === 'nativeUnchecked')
  return unchecked ? kind + 8 : kind
}

/** Follow collections whose rows have one explicit typed-array representation. */
function rowType(node, scope, visited = new Set()) {
  if (!node) return null
  if (t.isIdentifier(node)) {
    const binding = scope.getBinding(node.name)
    if (!binding || visited.has(binding)) return null
    if (binding.nativeElementType) return binding.nativeElementType
    visited.add(binding)
    return rowType(binding.path.node?.init, binding.path.scope, visited)
  }
  if (t.isMemberExpression(node) && !node.computed) {
    const fields = t.isIdentifier(node.object)
      ? scope.getBinding(node.object.name)?.nativeFields
      : null
    const documented = fields?.get(node.property.name)
    return (
      documented
        ?.match(/^(?:Array<(\w+Array)>|(\w+Array)\[\])$/)
        ?.slice(1)
        .find(Boolean) ||
      matrixFields.get(node.property.name) ||
      null
    )
  }
  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    const returned = returnType(scope.getBinding(node.callee.name))
    return (
      returned
        ?.match(/^(?:Array<(\w+Array)>|(\w+Array)\[\])$/)
        ?.slice(1)
        .find(Boolean) || null
    )
  }
  const rows = t.isArrayExpression(node)
    ? node.elements
    : t.isObjectExpression(node)
      ? node.properties.map((property) => property.value)
      : []
  if (!rows.length) return null
  const types = rows.map((row) => arrayType(row, scope))
  return types[0] && types.every((type) => type === types[0]) ? types[0] : null
}

/**
 * Follow explicit typed-array construction and aliases in the native copy.
 *
 * @param {object} node - Expression to inspect
 * @param {object} scope - Containing lexical scope
 * @param {Set<object>} [visited] - Bindings already followed
 * @returns {string|null} Concrete typed-array constructor, when proven
 */
function arrayType(node, scope, visited = new Set()) {
  if (!node) return null
  if (t.isParenthesizedExpression(node))
    return arrayType(node.expression, scope, visited)
  if (t.isTSAsExpression(node))
    return arrayType(node.expression, scope, visited)
  if (
    t.isNewExpression(node) &&
    t.isIdentifier(node.callee) &&
    /^(Float|Int|Uint)\d+Array$/.test(node.callee.name)
  )
    return node.callee.name
  if (t.isIdentifier(node)) {
    const binding = scope.getBinding(node.name)
    if (!binding || visited.has(binding)) return null
    if (binding.nativeArrayType) return binding.nativeArrayType
    visited.add(binding)
    if (binding.kind === 'module')
      return arrayGlobals.get(binding.path.node.imported?.name) || null
    return arrayType(binding.path.node?.init, binding.path.scope, visited)
  }
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    if (node.computed) {
      const row = rowType(node.object, scope)
      if (row) return row
    }
    if (node.computed && t.isIdentifier(node.object)) {
      const binding = scope.getBinding(node.object.name)
      if (binding?.nativeElementType) return binding.nativeElementType
    }
    if (!node.computed && t.isIdentifier(node.property)) {
      if (t.isIdentifier(node.object)) {
        const fields = scope.getBinding(node.object.name)?.nativeFields
        const type = fields?.get(node.property.name)
        if (/^(Float|Int|Uint)\d+Array$/.test(type)) return type
      }
      return arrayFields.get(node.property.name) || null
    }
  }
  if (
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    ['slice', 'subarray', 'fill'].includes(node.callee.property.name)
  )
    return arrayType(node.callee.object, scope, visited)
  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    const type = returnType(scope.getBinding(node.callee.name))
    if (/^(Float|Int|Uint)\d+Array$/.test(type)) return type
  }
  if (
    t.isLogicalExpression(node) &&
    node.operator === '??' &&
    t.isCallExpression(node.right) &&
    t.isIdentifier(node.right.callee, { name: 'throwError' })
  )
    return arrayType(node.left, scope, visited)
  if (t.isLogicalExpression(node) && node.operator === '??') {
    const fallback = arrayType(node.right, scope, visited)
    if (
      fallback &&
      t.isIdentifier(node.left) &&
      scope.getBinding(node.left.name)?.nativeNullableArrayType === fallback
    )
      return fallback
  }
  if (
    t.isCallExpression(node) &&
    t.isArrowFunctionExpression(node.callee) &&
    t.isBlockStatement(node.callee.body)
  ) {
    const returned = node.callee.body.body.find((statement) =>
      t.isReturnStatement(statement)
    )?.argument
    if (t.isIdentifier(returned)) {
      for (const statement of node.callee.body.body) {
        if (!t.isVariableDeclaration(statement)) continue
        const declaration = statement.declarations.find((declaration) =>
          t.isIdentifier(declaration.id, { name: returned.name })
        )
        if (declaration) return arrayType(declaration.init, scope, visited)
      }
    }
  }
  return null
}

/** Record a field type only when its explicit initializers agree. */
function recordArrayField(name, type) {
  if (!arrayFields.has(name)) arrayFields.set(name, type)
  else if (arrayFields.get(name) !== type) arrayFields.set(name, null)
}

/**
 * Translate a documented numeric type without guessing an array representation.
 *
 * @param {string} name - Existing JSDoc type
 * @returns {object|null} Babel type annotation for the native copy
 */
function documentedType(name) {
  name = name.trim().replace(/Array\.</g, 'Array<')
  if (name === 'Buffer') return t.tsTypeReference(t.identifier('Uint8Array'))
  if (name === 'number' || name === 'f64')
    return t.tsTypeReference(t.identifier('f64'))
  if (name === 'i32') return t.tsTypeReference(t.identifier('i32'))
  if (/^(Float|Int|Uint)\d+Array$/.test(name)) {
    return t.tsTypeReference(t.identifier(name))
  }
  if (name === 'Array<number>' || name === 'number[]') {
    return t.tsArrayType(t.tsNumberKeyword())
  }
  if (name.includes('|')) {
    const types = name.split('|').map(documentedType)
    if (types.every(Boolean)) return t.tsUnionType(types)
  }
  const arrays = name.match(/^(?:Array<(\w+Array)>|(\w+Array)\[\])$/)
  if (arrays) {
    const element = documentedType(arrays[1] || arrays[2])
    if (element) return t.tsArrayType(element)
  }
  return null
}

/**
 * Determine the numeric shape of an expression without changing array storage.
 *
 * @param {object} node - Babel expression node
 * @param {object} scope - Lexical scope containing the expression
 * @param {Set<object>} [visited] - Bindings already inspected
 * @returns {string|null} Numeric scalar, integer, numeric array, or array of arrays
 */
function numericShape(node, scope, visited = new Set()) {
  if (!node) return null
  if (t.isParenthesizedExpression(node))
    return numericShape(node.expression, scope, visited)
  if (t.isTSAsExpression(node)) {
    const type = node.typeAnnotation.typeName?.name
    if (type === 'i32') return 'integer'
    if (type === 'f64') return 'number'
    return numericShape(node.expression, scope, visited)
  }
  if (t.isNumericLiteral(node))
    return Number.isInteger(node.value) &&
      node.value >= -2147483648 &&
      node.value <= 2147483647
      ? 'integer'
      : 'number'
  if (arrayType(node, scope)) return 'array'
  if (t.isIdentifier(node)) {
    if (node.name === 'Infinity' || node.name === 'NaN') return 'number'
    const binding = scope.getBinding(node.name)
    if (!binding || visited.has(binding)) return null
    if (binding.nativeShape) return binding.nativeShape
    if (
      binding.kind === 'module' &&
      numericGlobals.has(binding.path.node.imported?.name)
    )
      return integerGlobals.has(binding.path.node.imported?.name)
        ? 'integer'
        : 'number'
    visited.add(binding)
    return numericShape(binding.path.node?.init, binding.path.scope, visited)
  }
  if (
    t.isNewExpression(node) &&
    t.isIdentifier(node.callee) &&
    /^(Float|Int|Uint)\d+Array$/.test(node.callee.name)
  )
    return 'array'
  if (t.isUnaryExpression(node) && ['+', '-', '~'].includes(node.operator))
    return node.operator === '~' ? 'integer' : 'number'
  if (t.isBinaryExpression(node)) {
    const left = numericShape(node.left, scope, new Set(visited))
    const right = numericShape(node.right, scope, new Set(visited))
    if (
      ['+', '-', '*', '%'].includes(node.operator) &&
      left === 'integer' &&
      right === 'integer'
    )
      return 'integer'
    if (['|', '&', '^', '<<', '>>'].includes(node.operator)) return 'integer'
    if (['-', '*', '/', '%', '**', '>>>'].includes(node.operator))
      return 'number'
    if (
      node.operator === '+' &&
      ['number', 'integer'].includes(
        numericShape(node.left, scope, new Set(visited))
      ) &&
      ['number', 'integer'].includes(
        numericShape(node.right, scope, new Set(visited))
      )
    )
      return 'number'
  }
  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    const type = returnType(scope.getBinding(node.callee.name))
    if (type === 'i32') return 'integer'
    if (type === 'number' || type === 'f64') return 'number'
  }
  if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
    if (t.isIdentifier(node.callee.object, { name: 'Math' })) {
      if (
        ['floor', 'ceil', 'trunc'].includes(node.callee.property.name) &&
        node.arguments.length === 1
      ) {
        const argument = node.arguments[0]
        // Rounding a bounded integer ratio with a positive divisor stays i32.
        if (
          numericShape(argument, scope, new Set(visited)) === 'integer' ||
          (t.isBinaryExpression(argument, { operator: '/' }) &&
            numericShape(argument.left, scope, new Set(visited)) ===
              'integer' &&
            t.isNumericLiteral(argument.right) &&
            argument.right.value >= 1)
        )
          return 'integer'
      }
      if (
        ['min', 'max'].includes(node.callee.property.name) &&
        node.arguments.every(
          (argument) =>
            numericShape(argument, scope, new Set(visited)) === 'integer'
        )
      )
        return 'integer'
      return 'number'
    }
    if (
      t.isIdentifier(node.callee.property) &&
      ['slice', 'subarray'].includes(node.callee.property.name)
    )
      return numericShape(node.callee.object, scope, visited)
  }
  if (t.isConditionalExpression(node)) {
    const consequent = numericShape(node.consequent, scope, new Set(visited))
    const alternate = numericShape(node.alternate, scope, new Set(visited))
    if (
      ['number', 'integer'].includes(consequent) &&
      ['number', 'integer'].includes(alternate)
    )
      return 'number'
  }
  if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) {
    if (!node.computed && t.isIdentifier(node.property)) {
      if (t.isIdentifier(node.object)) {
        const type = scope
          .getBinding(node.object.name)
          ?.nativeFields?.get(node.property.name)
        if (type === 'i32') return 'integer'
        if (type === 'number' || type === 'f64') return 'number'
        if (type === 'number[]' || type === 'Array<number>') return 'array'
      }
      if (integerFields.has(node.property.name)) return 'integer'
      if (node.property.name === 'length' && arrayType(node.object, scope))
        return 'integer'
      if (
        node.property.name === 'length' ||
        numericFields.has(node.property.name)
      )
        return 'number'
      if (numericArrayFields.has(node.property.name)) return 'array'
    }
    if (node.computed) {
      if (
        ['Int32Array', 'Uint8Array', 'Int16Array'].includes(
          arrayType(node.object, scope)
        )
      )
        return 'integer'
      const array = numericShape(node.object, scope, visited)
      if (array === 'array') return 'number'
      if (array === 'arrays') return 'array'
    }
  }
  if (
    t.isLogicalExpression(node) &&
    node.operator === '??' &&
    t.isCallExpression(node.right) &&
    t.isIdentifier(node.right.callee, { name: 'throwError' })
  )
    return numericShape(node.left, scope, visited)
  return null
}

/**
 * Read explicit field initializers before preparing native source copies.
 *
 * @param {string} directory - Codec directory to inspect
 */
function collectNumericFields(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      collectNumericFields(filename)
      continue
    }
    if (!entry.name.endsWith('.js')) continue
    transformSync(fs.readFileSync(filename, 'utf8'), {
      babelrc: false,
      configFile: false,
      plugins: [
        () => ({
          visitor: {
            Program(p, state) {
              collectDocumentedTypes(p, state)
            },
            Function(p) {
              for (const tag of documentedTags(p)) {
                if (tag.kind !== 'param' || !tag.name || tag.name.includes('.'))
                  continue
                const binding = p.scope.getBinding(tag.name)
                if (binding) recordDocumentedBinding(binding, tag.type)
              }
            },
            VariableDeclarator(p) {
              if (
                t.isIdentifier(p.node.id) &&
                (p.parentPath.parentPath.isProgram() ||
                  p.parentPath.parentPath.isExportNamedDeclaration())
              ) {
                const type = arrayType(p.node.init, p.scope)
                if (type) arrayGlobals.set(p.node.id.name, type)
                if (
                  ['number', 'integer'].includes(
                    numericShape(p.node.init, p.scope)
                  )
                )
                  numericGlobals.add(p.node.id.name)
                if (numericShape(p.node.init, p.scope) === 'integer')
                  integerGlobals.add(p.node.id.name)
              }
            },
            ObjectProperty(p) {
              if (!p.parentPath.isObjectExpression()) return
              const row = rowType(p.node.value, p.scope)
              if (row && t.isIdentifier(p.node.key))
                matrixFields.set(p.node.key.name, row)
              if (t.isIdentifier(p.node.key))
                recordArrayField(
                  p.node.key.name,
                  arrayType(p.node.value, p.scope)
                )
              if (
                t.isIdentifier(p.node.key) &&
                numericShape(p.node.value, p.scope) === 'array'
              )
                numericArrayFields.add(p.node.key.name)
            },
            AssignmentExpression(p) {
              if (
                !t.isMemberExpression(p.node.left) ||
                p.node.left.computed ||
                !t.isThisExpression(p.node.left.object)
              )
                return
              if (t.isObjectExpression(p.node.right)) {
                const fields = new Map()
                for (const property of p.node.right.properties) {
                  if (
                    !t.isObjectProperty(property) ||
                    !t.isIdentifier(property.key)
                  )
                    continue
                  const type = arrayType(property.value, p.scope)
                  if (type) fields.set(property.key.name, type)
                }
                if (fields.size)
                  objectFields.set(p.node.left.property.name, fields)
              }
              recordArrayField(
                p.node.left.property.name,
                arrayType(p.node.right, p.scope)
              )
              const row = rowType(p.node.right, p.scope)
              if (row) matrixFields.set(p.node.left.property.name, row)
              const shape = numericShape(p.node.right, p.scope)
              if (shape === 'array')
                numericArrayFields.add(p.node.left.property.name)
              if (shape === 'number' || shape === 'integer')
                numericFields.add(p.node.left.property.name)
              const name = p.node.left.property.name
              if (shape === 'integer' && !nonIntegerFields.has(name)) {
                integerFields.add(name)
              } else {
                nonIntegerFields.add(name)
                integerFields.delete(name)
              }
            },
          },
        }),
      ],
    })
  }
}

/**
 * Lower documented parameter and return types for native compilation.
 *
 * @param {object} p - Babel node path
 */
function annotateNativeFunction(p) {
  p.node.async = false
  const tags = documentedTags(p)
  const returned = tags.find((tag) => tag.kind === 'returns')
  const annotation =
    returned && documentedType(resolveDocumentedType(returned.type, p.scope))
  if (annotation) p.node.returnType = t.tsTypeAnnotation(annotation)
  for (const tag of tags.filter((tag) => tag.kind === 'param')) {
    if (!tag.name || tag.name.includes('.')) continue
    const binding = p.scope.getBinding(tag.name)
    if (!binding) continue
    const parameter = p.node.params.find((candidate) =>
      t.isIdentifier(
        t.isAssignmentPattern(candidate) ? candidate.left : candidate,
        { name: tag.name }
      )
    )
    if (!parameter) continue
    const target = t.isAssignmentPattern(parameter) ? parameter.left : parameter
    const type = resolveDocumentedType(tag.type, p.scope)
    recordDocumentedBinding(binding, type)
    // Porffor's scalar coercion must not erase a nonzero or object default.
    const preservesDefault =
      !t.isAssignmentPattern(parameter) ||
      t.isNumericLiteral(parameter.right, { value: 0 })
    const annotation = documentedType(type)
    if (annotation && preservesDefault)
      target.typeAnnotation = t.tsTypeAnnotation(annotation)
  }
}

/**
 * Infer numeric locals and typed-array aliases without narrowing file totals.
 *
 * @param {object} p - Babel node path
 */
function annotateNativeVariable(p) {
  if (t.isObjectPattern(p.node.id) && t.isIdentifier(p.node.init)) {
    const properties = p.node.id.properties
    if (
      properties.every(
        (property) =>
          t.isObjectProperty(property) &&
          t.isIdentifier(property.key) &&
          t.isIdentifier(property.value)
      )
    ) {
      const scope = p.scope
      const replacements = p.replaceWithMultiple(
        properties.map((property) =>
          t.variableDeclarator(
            property.value,
            t.memberExpression(t.cloneNode(p.node.init), property.key)
          )
        )
      )
      for (const replacement of replacements) {
        const binding = scope.getBinding(replacement.node.id.name)
        if (binding) {
          binding.path = replacement
          const array = arrayType(replacement.node.init, scope)
          if (array) {
            replacement.node.id.typeAnnotation = t.tsTypeAnnotation(
              t.tsTypeReference(t.identifier(array))
            )
            binding.nativeArrayType = array
          } else if (
            ['number', 'integer'].includes(
              numericShape(replacement.node.init, scope)
            )
          ) {
            replacement.node.id.typeAnnotation = t.tsTypeAnnotation(
              t.tsTypeReference(
                t.identifier(
                  numericShape(replacement.node.init, scope) === 'integer'
                    ? 'i32'
                    : 'f64'
                )
              )
            )
            binding.nativeShape = numericShape(replacement.node.init, scope)
          }
        }
      }
    }
    return
  }
  if (!t.isIdentifier(p.node.id)) return
  const declared = documentedTags(p).find((tag) => tag.kind === 'type')
  if (declared) {
    const binding = p.scope.getBinding(p.node.id.name)
    const type = resolveDocumentedType(declared.type, p.scope)
    recordDocumentedBinding(binding, type)
    const annotation = documentedType(type)
    if (annotation) {
      p.node.id.typeAnnotation = t.tsTypeAnnotation(annotation)
      return
    }
  }
  if (t.isMemberExpression(p.node.init) && !p.node.init.computed) {
    const fields = objectFields.get(p.node.init.property.name)
    if (fields) p.scope.getBinding(p.node.id.name).nativeFields = fields
  }
  const row = rowType(p.node.init, p.scope)
  if (row) p.scope.getBinding(p.node.id.name).nativeElementType = row
  const array = arrayType(p.node.init, p.scope)
  if (array) {
    p.node.id.typeAnnotation = t.tsTypeAnnotation(
      t.tsTypeReference(t.identifier(array))
    )
    p.scope.getBinding(p.node.id.name).nativeArrayType = array
    return
  }
  const shape = numericShape(p.node.init, p.scope)
  if (shape !== 'number' && shape !== 'integer') return
  const binding = p.scope.getBinding(p.node.id.name)
  const writesNumbers = binding.constantViolations.every(
    (write) =>
      write.isUpdateExpression() ||
      (write.isAssignmentExpression() &&
        ['number', 'integer'].includes(
          numericShape(write.node.right, write.scope)
        ))
  )
  if (!writesNumbers) return
  const writesIntegers = binding.constantViolations.every(
    (write) =>
      write.isUpdateExpression() ||
      (write.isAssignmentExpression() &&
        numericShape(write.node.right, write.scope) === 'integer')
  )
  const type =
    shape === 'integer' &&
    writesIntegers &&
    !p.parentPath.parentPath.isExportNamedDeclaration()
      ? 'i32'
      : 'f64'
  p.node.id.typeAnnotation = t.tsTypeAnnotation(
    t.tsTypeReference(t.identifier(type))
  )
  binding.nativeShape = type === 'i32' ? 'integer' : 'number'
}

/**
 * Adapt syntax and type hints in temporary copies, leaving codec sources intact.
 * Generator yields and per-stream state ownership remain unchanged.
 *
 * @param {string} source - Original JavaScript source
 * @param {string} relative - Repository-relative source path
 * @returns {string} Source consumed only by Porffor
 */
function transformForNative(source, relative) {
  let numericLoads = false
  return transformSync(source, {
    babelrc: false,
    configFile: false,
    plugins: [
      () => ({
        visitor: {
          ReferencedIdentifier(p) {
            const binding = p.scope.getBinding(p.node.name)
            if (binding?.kind !== 'module') return
            const declaration = binding.path.parentPath.node
            if (!t.isImportDeclaration(declaration)) return
            if (
              path.resolve(
                path.dirname(path.join(root, relative)),
                declaration.source.value
              ) !== path.join(root, codec.constants)
            )
              return
            const value = constants[binding.path.node.imported?.name]
            if (typeof value === 'number' && Number.isFinite(value))
              p.replaceWith(t.numericLiteral(value))
          },
          Program: {
            enter(p, state) {
              collectDocumentedTypes(p, state)
            },
            exit(p) {
              if (numericLoads) {
                p.node.body.unshift(
                  t.importDeclaration(
                    nativeHelpers.map((definition) =>
                      t.importSpecifier(
                        t.identifier(definition.name),
                        t.identifier(definition.name)
                      )
                    ),
                    t.stringLiteral(
                      path.relative(path.dirname(relative), 'host.js')
                    )
                  )
                )
              }
            },
          },
          Function(p) {
            annotateNativeFunction(p)
          },
          VariableDeclarator(p) {
            annotateNativeVariable(p)
          },
          AwaitExpression(p) {
            p.replaceWith(p.node.argument)
          },
          UpdateExpression(p) {
            if (!t.isIdentifier(p.node.argument)) return
            const binding = p.scope.getBinding(p.node.argument.name)
            if (binding?.nativeShape !== 'integer') return
            const discarded =
              p.parentPath.isExpressionStatement() ||
              (p.parentPath.isForStatement() &&
                p.parentPath.node.update === p.node)
            if (!discarded) return
            // Porffor lowers ++ through f64 even for bounded i32 loop indices.
            p.replaceWith(
              t.assignmentExpression(
                '=',
                t.cloneNode(p.node.argument),
                t.binaryExpression(
                  '|',
                  t.binaryExpression(
                    p.node.operator === '++' ? '+' : '-',
                    t.cloneNode(p.node.argument),
                    t.numericLiteral(1)
                  ),
                  t.numericLiteral(0)
                )
              )
            )
          },
          AssignmentExpression: {
            exit(p) {
              if (
                p.node.operator !== '=' ||
                !t.isMemberExpression(p.node.left) ||
                !p.node.left.computed
              )
                return
              const target = p.node.left
              const kind = nativeElementKind(
                arrayType(target.object, p.scope),
                p
              )
              if (
                kind === -1 ||
                (kind & 7) === 4 ||
                !['number', 'integer'].includes(
                  numericShape(p.node.right, p.scope)
                )
              )
                return
              numericLoads = true
              p.replaceWith(
                t.tsAsExpression(
                  t.callExpression(t.identifier('writeNativeNumber'), [
                    target.object,
                    target.property,
                    p.node.right,
                    t.numericLiteral(kind),
                  ]),
                  t.tsTypeReference(t.identifier('f64'))
                )
              )
            },
          },
          BinaryExpression: {
            exit(p) {
              if (
                p.node.operator === '**' &&
                t.isNumericLiteral(p.node.left, { value: 2 })
              ) {
                numericLoads = true
                p.replaceWith(
                  t.tsAsExpression(
                    t.callExpression(t.identifier('powerNativeTwo'), [
                      p.node.right,
                    ]),
                    t.tsTypeReference(t.identifier('f64'))
                  )
                )
                return
              }
              if (
                p.node.operator !== '%' ||
                numericShape(p.node.left, p.scope) !== 'integer' ||
                numericShape(p.node.right, p.scope) !== 'integer'
              )
                return
              numericLoads = true
              p.replaceWith(
                t.tsAsExpression(
                  t.callExpression(t.identifier('remainderNativeInteger'), [
                    p.node.left,
                    p.node.right,
                  ]),
                  t.tsTypeReference(t.identifier('f64'))
                )
              )
            },
          },
          ForOfStatement(p) {
            p.node.await = false
          },
          MemberExpression: {
            exit(p) {
              if (
                t.isIdentifier(p.node.object, { name: 'Symbol' }) &&
                t.isIdentifier(p.node.property, { name: 'asyncIterator' })
              )
                p.node.property.name = 'iterator'
              if (!p.node.computed) {
                if (!t.isIdentifier(p.node.object)) return
                const type = p.scope
                  .getBinding(p.node.object.name)
                  ?.nativeFields?.get(p.node.property.name)
                if (!['i32', 'f64', 'number'].includes(type)) return
                if (
                  p.parentPath.isTSAsExpression() ||
                  p.parentPath.isAssignmentExpression({ left: p.node }) ||
                  p.parentPath.isUpdateExpression()
                )
                  return
                p.replaceWith(t.tsAsExpression(p.node, documentedType(type)))
                p.skip()
                return
              }
              const shape = numericShape(p.node.object, p.scope)
              const array = arrayType(p.node.object, p.scope)
              const kind = nativeElementKind(array, p)
              const parent = p.parentPath
              const numericContext =
                parent.isUnaryExpression({ operator: '+' }) ||
                (parent.isBinaryExpression() &&
                  [
                    '+',
                    '-',
                    '*',
                    '/',
                    '%',
                    '**',
                    '<',
                    '>',
                    '<=',
                    '>=',
                    '|',
                    '&',
                    '^',
                    '<<',
                    '>>',
                    '>>>',
                  ].includes(parent.node.operator)) ||
                (parent.isVariableDeclarator() &&
                  parent.node.id.typeAnnotation) ||
                (parent.isAssignmentExpression() &&
                  parent.node.right === p.node &&
                  ((t.isMemberExpression(parent.node.left) &&
                    arrayType(parent.node.left.object, p.scope)) ||
                    (t.isIdentifier(parent.node.left) &&
                      ['number', 'integer'].includes(
                        p.scope.getBinding(parent.node.left.name)?.nativeShape
                      ))))
              if (kind !== -1 && numericContext) {
                numericLoads = true
                const integer = [2, 3, 4].includes(kind & 7)
                p.replaceWith(
                  t.tsAsExpression(
                    t.callExpression(t.identifier('readNativeNumber'), [
                      p.node.object,
                      p.node.property,
                      t.numericLiteral(kind),
                    ]),
                    t.tsTypeReference(t.identifier(integer ? 'i32' : 'f64'))
                  )
                )
                return
              }
              if (array && !t.isTSAsExpression(p.node.object)) {
                p.node.object = t.tsAsExpression(
                  p.node.object,
                  t.tsTypeReference(t.identifier(array))
                )
              }
              if (shape !== 'array') return
              if (
                !parent.isBinaryExpression() ||
                !['-', '*', '/', '%', '**', '<', '>', '<=', '>='].includes(
                  parent.node.operator
                )
              )
                return
              p.replaceWith(t.unaryExpression('+', t.cloneNode(p.node)))
              p.skip()
            },
          },
          CallExpression(p) {
            if (
              t.isMemberExpression(p.node.callee) &&
              t.isIdentifier(p.node.callee.property, { name: 'fill' }) &&
              p.node.arguments.length === 1 &&
              t.isNumericLiteral(p.node.arguments[0], { value: 0 }) &&
              p.parentPath.isExpressionStatement()
            ) {
              const kind = nativeElementKind(
                arrayType(p.node.callee.object, p.scope),
                p
              )
              if (kind !== -1) {
                numericLoads = true
                p.replaceWith(
                  t.callExpression(t.identifier('clearNativeArray'), [
                    p.node.callee.object,
                    t.numericLiteral(kind & 7),
                  ])
                )
                return
              }
            }
            // Embed explicit UTF-8 reads of static module-relative assets.
            const filename = p.node.arguments[0]
            if (
              t.isMemberExpression(p.node.callee) &&
              t.isIdentifier(p.node.callee.property, {
                name: 'readFileSync',
              }) &&
              t.isNewExpression(filename) &&
              t.isIdentifier(filename.callee, { name: 'URL' }) &&
              t.isStringLiteral(filename.arguments[0]) &&
              t.isMemberExpression(filename.arguments[1]) &&
              t.isMetaProperty(filename.arguments[1].object) &&
              t.isIdentifier(filename.arguments[1].property, { name: 'url' }) &&
              t.isStringLiteral(p.node.arguments[1], { value: 'utf8' })
            ) {
              const asset = path.resolve(
                root,
                path.dirname(relative),
                filename.arguments[0].value
              )
              p.replaceWith(t.stringLiteral(fs.readFileSync(asset, 'utf8')))
              return
            }
            if (
              t.isMemberExpression(p.node.callee) &&
              t.isIdentifier(p.node.callee.object, { name: 'Math' }) &&
              ['min', 'max'].includes(p.node.callee.property.name) &&
              p.node.arguments.length === 2 &&
              p.node.arguments.every((argument) =>
                ['number', 'integer'].includes(numericShape(argument, p.scope))
              )
            ) {
              numericLoads = true
              const name =
                p.node.callee.property.name === 'min'
                  ? 'minimumNativeNumber'
                  : 'maximumNativeNumber'
              p.replaceWith(
                t.tsAsExpression(
                  t.callExpression(t.identifier(name), p.node.arguments),
                  t.tsTypeReference(t.identifier('f64'))
                )
              )
              return
            }
            if (
              t.isMemberExpression(p.node.callee) &&
              t.isIdentifier(p.node.callee.property, { name: 'toString' }) &&
              t.isStringLiteral(p.node.arguments[0])
            ) {
              p.replaceWith(
                t.callExpression(
                  t.memberExpression(
                    t.identifier('Buffer'),
                    t.identifier('decode')
                  ),
                  [p.node.callee.object, ...p.node.arguments]
                )
              )
              return
            }
          },
        },
      }),
    ],
  }).code
}

/** Copy transformed source files into the temporary compiler workspace. */
function stage(directory) {
  fs.mkdirSync(path.join(work, directory), { recursive: true })
  for (const entry of fs.readdirSync(path.join(root, directory), {
    withFileTypes: true,
  })) {
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      stage(relative)
      continue
    }
    if (!entry.name.endsWith('.js')) continue
    const code = transformForNative(
      fs.readFileSync(path.join(root, relative), 'utf8'),
      relative
    )
    fs.writeFileSync(path.join(work, relative), code)
  }
}
for (const directory of codec.sources)
  collectNumericFields(path.join(root, directory))
prepareRuntime()
for (const directory of codec.sources) stage(directory)
fs.writeFileSync(
  path.join(work, 'entry.js'),
  "import './host.js'; import " + JSON.stringify('./' + codec.entry) + '\n'
)
/**
 * Run the compiler, reporting failures before copying output.
 *
 * @param {string} command - Executable path
 * @param {string[]} args - Command arguments
 * @param {object} [options={}] - Additional child-process options
 */
function runBuildCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(command + ' failed: ' + result.status)
}

/**
 * Compile the staged program with strict floating-point behavior.
 *
 * @param {string} name - Temporary output name
 * @returns {string} Compiled executable path
 */
function compileNative(name) {
  const wrapper = path.join(work, name + '-cc')
  const executable = path.join(work, name)
  const compilerWrapper = [
    '#!/bin/sh',
    ...(process.platform === 'linux'
      ? [
          'case " $* " in',
          '  *" -c "*) ;;',
          '  *) set -- -fuse-ld=lld "$@" ;;',
          'esac',
        ]
      : []),
    'exec "$CC" -fno-fast-math -ffp-contract=off -fno-math-errno "$@"',
    '',
  ].join('\n')
  fs.writeFileSync(wrapper, compilerWrapper, { mode: 0o755 })
  runBuildCommand(
    porffor,
    [
      'native',
      '-t',
      path.join(work, 'entry.js'),
      '-o',
      executable,
      '--compiler=' + wrapper,
      '-j2',
      '--flto',
      '--fast-length',
    ],
    {
      env: {
        ...process.env,
        CC: nativeCompiler,
      },
    }
  )
  return executable
}

const nativeCompiler = process.env.CC || 'clang'
console.log('Native build staging: ' + work)
const executable = compileNative(codec.name + '-compiled')
fs.copyFileSync(executable, output)
fs.chmodSync(output, 0o755)
console.log('Built ' + output)
