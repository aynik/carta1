/** Build-only Porffor adapters. Nothing generated here enters the npm tree. */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync, types as t } from '@babel/core'
import * as constants from '../codec/core/constants.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'carta1-aot-'))
const output = path.resolve(process.argv[2] || path.join(work, 'carta1'))
const porffor = process.env.PORFFOR || 'porf'
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')))

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

/** UTF-8 encoding used by AEA titles and native terminal output. */
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

/** The Buffer operations used by the existing CLI and AEA reader. */
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

/** Yield bounded blocks for the existing AEA reader; never collect the file. */
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

/** Write the JSON inspection result using the native filesystem interface. */
function writeNativeContents(filename, value) {
  const file = openNativeFile(filename, 'w')
  try {
    const bytes =
      typeof value === 'string' ? new NativeTextEncoder().encode(value) : value
    file.write(bytes, 0, bytes.length, null)
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

/** Commander uses this event interface for option parsing. */
class NativeEventEmitter {
  constructor() {
    this.events = {}
  }
  on(name, callback) {
    ;(this.events[name] ||= []).push(callback)
    return this
  }
  emit(name, ...args) {
    for (const callback of this.events[name] || []) callback(...args)
    return Boolean(this.events[name]?.length)
  }
  listeners(name) {
    return this.events[name] || []
  }
  listenerCount(name) {
    return this.listeners(name).length
  }
  removeListener(name, callback) {
    this.events[name] = this.listeners(name).filter(
      (value) => value !== callback
    )
    return this
  }
}

/** Install build-only host bindings before loading the original CLI. */
function installNativeRuntime() {
  let count = 0
  Porffor.c`
    count = porf_argc;
  `
  const argv = ['carta1', 'cli.js']
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
      writeFile: writeNativeContents,
    },
    statSync: statNativePath,
    existsSync: nativePathExists,
    createReadStream: readNativeStream,
    realpathSync: (value) => value,
  }
  globalThis.__nativeEvents = NativeEventEmitter
}

/** Emit the small builtin-module adapters beside the temporary source tree. */
function prepareRuntime() {
  fs.mkdirSync(path.join(work, 'node_modules'))
  fs.symlinkSync(
    path.join(root, 'node_modules/commander'),
    path.join(work, 'node_modules/commander'),
    'dir'
  )
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
    writeNativeContents,
    readNativeArgument,
    createNativeTerminal,
    exitNativeProcess,
    NativeEventEmitter,
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
      .join('\n\n') + '\ninstallNativeRuntime()\n'
  )
  fs.writeFileSync(
    path.join(work, 'package.json'),
    JSON.stringify({ type: 'module' })
  )
  const aliases = {
    fs: 'module.exports = globalThis.__nativeFs',
    process: 'module.exports = globalThis.process',
    events:
      'module.exports = globalThis.__nativeEvents; module.exports.EventEmitter = globalThis.__nativeEvents',
    child_process: 'module.exports = {}',
    perf_hooks: 'exports.performance = globalThis.performance',
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

/** Path operations exercised by Commander's argument parser. */
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

/** Preserve UTF-16 dump strings through Porffor's byte-only JSON serializer. */
function stringifyNativeDump(value, space = 2) {
  return JSON.stringify(
    value,
    (key, item) => {
      if (typeof item !== 'string') return item
      let quoted = '"'
      for (let index = 0; index < item.length; index++) {
        const code = item.charCodeAt(index)
        if (code < 32 || code > 126) {
          quoted += '\\u' + code.toString(16).padStart(4, '0')
        } else {
          if (code === 34 || code === 92) quoted += '\\'
          quoted += String.fromCharCode(code)
        }
      }
      return JSON.rawJSON(quoted + '"')
    },
    space
  )
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
const nativeHelpers = [...nativeIntrinsics, stringifyNativeDump]

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
const integerParameters = new Set([
  'activeBfuCount',
  'maxBfuCount',
  'remainingBits',
  'startIndex',
  'heapSize',
  'length',
  'inputOffset',
  'delayRow',
  'bandIndex',
  'blockMode',
  'blockSize',
  'fftSize',
  'scaleFactorIndex',
  'bitsPerSample',
  'bitPosition',
  'bitCount',
  'channelCount',
  'offset',
  'frameSize',
  'destinationOffset',
])

/** Numeric return contract already declared by a function's JSDoc. */
function returnType(binding) {
  const node = binding?.path.node
  if (!node) return null
  const comments =
    node.leadingComments || binding.path.parentPath?.node.leadingComments || []
  const documentation = comments.map((comment) => comment.value).join('\n')
  return documentation.match(/@returns?\s+\{([^}]+)\}/)?.[1] || null
}

/** Integer lookup tables contain bounded codec geometry and bit counts. */
function integerTable(node, scope) {
  if (t.isTSAsExpression(node)) return integerTable(node.expression, scope)
  if (!t.isIdentifier(node)) return false
  const binding = scope.getBinding(node.name)
  if (binding?.kind !== 'module') return false
  const type = arrayGlobals.get(binding.path.node.imported?.name)
  return type === 'Int32Array' || type === 'Uint8Array'
}

/**
 * QMF geometry and heap guards bound their indices. Allocation candidates fit
 * their frame-local arrays, with scale indices clamped to the 64-entry table.
 * Native FFT callers use
 * paired power-of-two scratch rows from BufferPool or transient detection.
 * MDCT callers use fixed transform rows, with allocated outputs and offset zero.
 */
function nativeElementKind(array, p, relative) {
  const kind = [
    'Float32Array',
    'Float64Array',
    'Int32Array',
    'Uint8Array',
    'Int16Array',
  ].indexOf(array)
  if (kind === -1) return kind
  const ownerNode = p.getFunctionParent()?.node
  const owner = ownerNode?.id?.name || ownerNode?.key?.name
  return (relative === 'codec/signal/qmf.js' &&
    ['analyzeQmf', 'synthesizeQmf'].includes(owner)) ||
    (relative === 'codec/allocation/solve.js' &&
      ['siftDown', 'distributeBits', 'measureDistortion'].includes(owner)) ||
    (relative === 'codec/signal/fft.js' && owner === 'transform') ||
    (relative === 'codec/signal/mdct.js' && owner === 'transform')
    ? kind + 8
    : kind
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
  if (t.isMemberExpression(node) && !node.computed)
    return matrixFields.get(node.property.name) || null
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
        if (fields?.has(node.property.name))
          return fields.get(node.property.name)
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
  if (name === 'Buffer') return t.tsTypeReference(t.identifier('Uint8Array'))
  if (name === 'number') return t.tsTypeReference(t.identifier('f64'))
  if (/^(Float|Int|Uint)\d+Array$/.test(name)) {
    return t.tsTypeReference(t.identifier(name))
  }
  if (name === 'Array<number>') {
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
    return Number.isInteger(node.value) ? 'integer' : 'number'
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
  if (
    t.isCallExpression(node) &&
    t.isIdentifier(node.callee) &&
    returnType(scope.getBinding(node.callee.name)) === 'number'
  )
    return 'number'
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
      if (integerTable(node.object, scope)) return 'integer'
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
            Function(p) {
              const comments =
                p.node.leadingComments ||
                p.parentPath.node.leadingComments ||
                []
              for (const match of comments
                .map((comment) => comment.value)
                .join('\n')
                .matchAll(/@param\s+\{number\}\s+\[?(\w+)/g)) {
                const binding = p.scope.getBinding(match[1])
                if (binding) binding.nativeShape = 'number'
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
 * @param {string} relative - Repository-relative source path
 */
function annotateNativeFunction(p, relative) {
  p.node.async = false
  if (!relative.startsWith('codec/') && relative !== 'bin/cli.js') return
  const comments =
    p.node.leadingComments || p.parentPath.node.leadingComments || []
  const documentation = comments.map((comment) => comment.value).join('\n')
  const returnedType = documentation.match(/@returns?\s+\{([^}]+)\}/)?.[1]
  const resultAnnotation = returnedType && documentedType(returnedType)
  if (resultAnnotation) p.node.returnType = t.tsTypeAnnotation(resultAnnotation)
  for (const match of documentation.matchAll(
    /@param\s+\{([^}]+)\}\s+\[?([\w]+)/g
  )) {
    const binding = p.scope.getBinding(match[2])
    if (!binding) continue
    const record = match[1][0].toLowerCase() + match[1].slice(1)
    if (objectFields.has(record))
      binding.nativeFields = objectFields.get(record)
    const parameter = p.node.params
      .map((parameter) =>
        t.isAssignmentPattern(parameter) ? parameter.left : parameter
      )
      .find((parameter) => t.isIdentifier(parameter, { name: match[2] }))
    if (/^(Float|Int|Uint)\d+Array\|null$/.test(match[1]))
      binding.nativeNullableArrayType = match[1].split('|')[0]
    const integer = match[1] === 'number' && integerParameters.has(match[2])
    const annotation = integer
      ? t.tsTypeReference(t.identifier('i32'))
      : documentedType(match[1])
    const defaultParameter = p.node.params.find(
      (candidate) =>
        t.isAssignmentPattern(candidate) && candidate.left === parameter
    )
    const preservesDefault =
      !defaultParameter ||
      t.isNumericLiteral(defaultParameter.right, { value: 0 })
    if (annotation && parameter && preservesDefault) {
      parameter.typeAnnotation = t.tsTypeAnnotation(annotation)
      if (
        /^(Float|Int|Uint)\d+Array$/.test(match[1]) ||
        match[1] === 'Buffer'
      ) {
        binding.nativeArrayType =
          match[1] === 'Buffer' ? 'Uint8Array' : match[1]
      }
    }
    if (
      match[1] === 'Array<number>' ||
      match[1]
        .split('|')
        .every((name) => /^(Float|Int|Uint)\d+Array$/.test(name))
    )
      binding.nativeShape = 'array'
    if (/^(?:Array<\w+Array>|\w+Array\[\])$/.test(match[1])) {
      binding.nativeShape = 'arrays'
      binding.nativeElementType = match[1].match(/\w+Array/)[0]
    }
    if (match[1] === 'number')
      binding.nativeShape = integer ? 'integer' : 'number'
  }
}

/**
 * Infer numeric locals and typed-array aliases without narrowing file totals.
 *
 * @param {object} p - Babel node path
 * @param {string} relative - Repository-relative source path
 */
function annotateNativeVariable(p, relative) {
  if (!relative.startsWith('codec/') && relative !== 'bin/cli.js') return
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
            const integer =
              relative.startsWith('codec/') &&
              numericShape(replacement.node.init, scope) === 'integer'
            replacement.node.id.typeAnnotation = t.tsTypeAnnotation(
              t.tsTypeReference(t.identifier(integer ? 'i32' : 'f64'))
            )
            binding.nativeShape = integer ? 'integer' : 'number'
          }
        }
      }
    }
    return
  }
  if (!t.isIdentifier(p.node.id)) return
  if (t.isMemberExpression(p.node.init) && !p.node.init.computed) {
    const fields = objectFields.get(p.node.init.property.name)
    if (fields) p.scope.getBinding(p.node.id.name).nativeFields = fields
  }
  const row = rowType(p.node.init, p.scope)
  if (row) p.scope.getBinding(p.node.id.name).nativeElementType = row
  if (
    t.isMemberExpression(p.node.init) &&
    t.isIdentifier(p.node.init.object, { name: 'Math' })
  ) {
    const binding = p.scope.getBinding(p.node.id.name)
    if (binding.constant) {
      for (const reference of binding.referencePaths)
        reference.replaceWith(t.cloneNode(p.node.init))
    }
  }
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
  const integerLoop =
    p.parentPath.parentPath.isForStatement() &&
    t.isNumericLiteral(p.node.init) &&
    Number.isInteger(p.node.init.value)
  const ownerFunction = p.getFunctionParent()?.node
  const owner = ownerFunction?.key?.name || ownerFunction?.id?.name
  // File positions and stream totals must retain JavaScript's range.
  const bounded =
    relative.startsWith('codec/') ||
    ['_processFrameBuffer', 'readPcmSample'].includes(owner)
  const type =
    bounded &&
    !p.parentPath.parentPath.isExportNamedDeclaration() &&
    (integerLoop || (shape === 'integer' && writesIntegers))
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
              ) !== path.join(root, 'codec/core/constants.js')
            )
              return
            const value = constants[binding.path.node.imported?.name]
            if (typeof value === 'number' && Number.isFinite(value))
              p.replaceWith(t.numericLiteral(value))
          },
          Program: {
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
          ExportNamedDeclaration(p) {
            if (relative === 'bin/cli.js' && !p.node.declaration) p.remove()
          },
          Function(p) {
            annotateNativeFunction(p, relative)
          },
          VariableDeclarator(p) {
            annotateNativeVariable(p, relative)
          },
          AwaitExpression(p) {
            p.replaceWith(p.node.argument)
          },
          UpdateExpression(p) {
            if (!relative.startsWith('codec/')) return
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
                (!relative.startsWith('codec/') && relative !== 'bin/cli.js') ||
                p.node.operator !== '=' ||
                !t.isMemberExpression(p.node.left) ||
                !p.node.left.computed
              )
                return
              const target = p.node.left
              const kind = nativeElementKind(
                arrayType(target.object, p.scope),
                p,
                relative
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
                relative.startsWith('codec/') &&
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
                !relative.startsWith('codec/') ||
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
              if (!relative.startsWith('codec/') && relative !== 'bin/cli.js')
                return
              if (!p.node.computed) return
              const shape = numericShape(p.node.object, p.scope)
              const array = arrayType(p.node.object, p.scope)
              const kind = nativeElementKind(array, p, relative)
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
                  t.isMemberExpression(parent.node.left) &&
                  arrayType(parent.node.left.object, p.scope))
              if (kind !== -1 && numericContext) {
                numericLoads = true
                const bitwise =
                  parent.isBinaryExpression() &&
                  ['|', '&', '^', '<<', '>>', '>>>'].includes(
                    parent.node.operator
                  )
                const integer =
                  integerTable(p.node.object, p.scope) ||
                  (bitwise && [2, 3, 4].includes(kind & 7))
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
                p,
                relative
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
            if (
              relative === 'bin/cli.js' &&
              t.isMemberExpression(p.node.callee) &&
              t.isIdentifier(p.node.callee.object, { name: 'JSON' }) &&
              t.isIdentifier(p.node.callee.property, { name: 'stringify' })
            ) {
              numericLoads = true
              p.replaceWith(
                t.callExpression(t.identifier('stringifyNativeDump'), [
                  p.node.arguments[0],
                  p.node.arguments[2] || t.numericLiteral(2),
                ])
              )
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
            // Node Buffer.slice is a view, unlike TypedArray.slice in Porffor.
            if (
              relative === 'codec/boundary/reader.js' &&
              t.isMemberExpression(p.node.callee) &&
              t.isIdentifier(p.node.callee.object, { name: 'buffer' }) &&
              t.isIdentifier(p.node.callee.property, { name: 'slice' })
            ) {
              p.node.callee.property.name = 'subarray'
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
            if (
              relative === 'bin/cli.js' &&
              t.isMemberExpression(p.node.callee) &&
              t.isIdentifier(p.node.callee.property, {
                name: 'readFileSync',
              })
            )
              p.replaceWith(t.stringLiteral(JSON.stringify(pkg)))
          },
          ExpressionStatement(p) {
            const call = p.node.expression
            if (
              !t.isCallExpression(call) ||
              !t.isMemberExpression(call.callee) ||
              !t.isIdentifier(call.callee.property, { name: 'catch' }) ||
              !t.isCallExpression(call.callee.object) ||
              !t.isIdentifier(call.callee.object.callee, { name: 'main' })
            )
              return
            const callback = call.arguments[0]
            p.replaceWith(
              t.tryStatement(
                t.blockStatement([t.expressionStatement(call.callee.object)]),
                t.catchClause(callback.params[0], callback.body)
              )
            )
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
collectNumericFields(path.join(root, 'codec'))
collectNumericFields(path.join(root, 'bin'))
prepareRuntime()
stage('bin')
stage('codec')
fs.writeFileSync(
  path.join(work, 'entry.js'),
  "import './host.js'; import './bin/cli.js'\n"
)
/**
 * Run a compiler or training process, reporting failures before copying output.
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
 * Compile the same staged program for instrumentation or profile use.
 *
 * @param {string} name - Temporary output name
 * @param {boolean} instrument - Gather execution counts instead of using them
 * @returns {string} Compiled executable path
 */
function compileNative(name, instrument) {
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
    'exec "$CC" -fno-fast-math -ffp-contract=off -fno-math-errno ' +
      (instrument
        ? '-fprofile-instr-generate'
        : '"-fprofile-instr-use=$CARTA1_NATIVE_PROFILE"') +
      ' "$@"',
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
        CARTA1_NATIVE_PROFILE: path.join(work, 'profile.profdata'),
      },
    }
  )
  return executable
}

/**
 * Exercise PCM conversion and codec branches with a short, deterministic stream.
 * The fixture and compiler profiles stay in the temporary build directory.
 *
 * @param {number} bitDepth - Integer PCM sample width
 * @returns {string} Training WAV path
 */
function createTrainingWave(bitDepth) {
  const sampleRate = 44100
  const sampleCount = sampleRate * 4
  const width = bitDepth / 8
  const blockAlign = width * 2
  const dataSize = sampleCount * blockAlign
  const wave = Buffer.alloc(44 + dataSize)
  wave.write('RIFF', 0)
  wave.writeUInt32LE(36 + dataSize, 4)
  wave.write('WAVEfmt ', 8)
  wave.writeUInt32LE(16, 16)
  wave.writeUInt16LE(1, 20)
  wave.writeUInt16LE(2, 22)
  wave.writeUInt32LE(sampleRate, 24)
  wave.writeUInt32LE(sampleRate * blockAlign, 28)
  wave.writeUInt16LE(blockAlign, 32)
  wave.writeUInt16LE(bitDepth, 34)
  wave.write('data', 36)
  wave.writeUInt32LE(dataSize, 40)
  let seed = 1
  for (let index = 0; index < sampleCount; index++) {
    seed = (1664525 * seed + 1013904223) >>> 0
    const noise = ((seed >>> 16) - 32768) / 8
    const tone = 10000 * Math.sin((index * 2 * Math.PI * 440) / sampleRate)
    const transient = noise * (index % 8192 < 256 ? 4 : 1)
    const scale = 2 ** (bitDepth - 16)
    const offset = 44 + index * blockAlign
    wave.writeIntLE(Math.trunc(tone + transient) * scale, offset, width)
    wave.writeIntLE(Math.trunc(tone - transient) * scale, offset + width, width)
  }
  const filename = path.join(work, 'training-' + bitDepth + '.wav')
  fs.writeFileSync(filename, wave)
  return filename
}

// Use matching Clang tools so instrumentation and profile formats agree.
const nativeCompiler = process.env.CC || 'clang'
const compilerInfo = spawnSync(nativeCompiler, ['--version'], {
  encoding: 'utf8',
})
if (compilerInfo.error) throw compilerInfo.error
if (!compilerInfo.stdout.toLowerCase().includes('clang')) {
  throw new Error('Native profile-guided compilation requires Clang')
}
const profileTool = spawnSync(
  nativeCompiler,
  ['-print-prog-name=llvm-profdata'],
  { encoding: 'utf8' }
)
if (profileTool.error) throw profileTool.error
if (profileTool.status !== 0 || !profileTool.stdout.trim()) {
  throw new Error('Clang could not locate llvm-profdata')
}

console.log('Native build staging: ' + work)
const training = compileNative('carta1-training', true)
const profileEnvironment = {
  ...process.env,
  LLVM_PROFILE_FILE: path.join(work, 'profile-%p.profraw'),
}
for (const bitDepth of [16, 24, 32]) {
  const source = createTrainingWave(bitDepth)
  const encoded = path.join(work, 'training.aea')
  const decoded = path.join(work, 'training.wav')
  runBuildCommand(training, ['-eqf', source, encoded], {
    env: profileEnvironment,
    timeout: 60000,
  })
  runBuildCommand(training, ['-dqf', encoded, decoded], {
    env: profileEnvironment,
    timeout: 60000,
  })
}
const profiles = fs
  .readdirSync(work)
  .filter((name) => name.endsWith('.profraw'))
  .map((name) => path.join(work, name))
runBuildCommand(profileTool.stdout.trim(), [
  'merge',
  '-output=' + path.join(work, 'profile.profdata'),
  ...profiles,
])
const executable = compileNative('carta1-compiled', false)
fs.copyFileSync(executable, output)
fs.chmodSync(output, 0o755)
console.log('Built ' + output)
