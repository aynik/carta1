/* global Porffor */
/* eslint-disable no-unused-vars -- Local pointers are referenced by embedded C. */
import { NativeTextDecoder, NativeTextEncoder } from './utf8.js'

// Imported before codec/index.js so its container initializes against these
// host primitives. They are confined to the native executable.
globalThis.TextEncoder = NativeTextEncoder
globalThis.TextDecoder = NativeTextDecoder

class NativeBlob {
  constructor(parts = [], options = {}) {
    const arrays = parts.map((part) => {
      if (part instanceof NativeBlob) return part.bytes
      if (part instanceof ArrayBuffer) return new Uint8Array(part)
      if (ArrayBuffer.isView(part))
        return new Uint8Array(part.buffer, part.byteOffset, part.byteLength)
      return new NativeTextEncoder().encode(String(part))
    })
    this.bytes = new Uint8Array(
      arrays.reduce((size, bytes) => size + bytes.length, 0)
    )
    let offset = 0
    for (const bytes of arrays) {
      this.bytes.set(bytes, offset)
      offset += bytes.length
    }
    this.size = this.bytes.length
    this.type = options.type || ''
  }

  async arrayBuffer() {
    return this.bytes.slice().buffer
  }
}
globalThis.Blob = NativeBlob

function argumentAt(argIndex) {
  let length = 0
  Porffor.c`length = strlen(porf_argv[(int)argIndex.val]);`
  const bytes = new Uint8Array(length)
  const pointer = Porffor.IR.ptr(bytes.buffer)
  Porffor.c`memcpy(MEM + (u32)pointer.val + 8, porf_argv[(int)argIndex.val], (size_t)length);`
  return new NativeTextDecoder().decode(bytes)
}

export function argumentsList() {
  let count = 0
  Porffor.c`count = porf_argc;`
  const args = []
  for (let index = 1; index < count; index++) args.push(argumentAt(index))
  return args
}

function pathBytes(path) {
  if (path.includes('\0')) throw new Error('File paths cannot contain NUL')
  const encoded = new NativeTextEncoder().encode(path)
  const bytes = new Uint8Array(encoded.length + 1)
  bytes.set(encoded)
  return bytes
}

export function readFile(path) {
  const filename = pathBytes(path)
  const pathPointer = Porffor.IR.ptr(filename.buffer)
  let handle = 0
  let length = -1
  Porffor.c`
  {
    FILE *stream = fopen((char*)MEM + (u32)pathPointer.val + 8, "rb");
    if (stream) {
      if (fseek(stream, 0, SEEK_END) == 0) {
        long size = ftell(stream);
        if (size >= 0 && size <= 2147483647 && fseek(stream, 0, SEEK_SET) == 0) {
          length = (f64)size;
          handle = (f64)(uintptr_t)stream;
        }
      }
      if (length < 0) fclose(stream);
    }
  }
  `
  if (length < 0) throw new Error(`Cannot read file: ${path}`)
  const bytes = new Uint8Array(length)
  const pointer = Porffor.IR.ptr(bytes.buffer)
  let status = 0
  Porffor.c`
  {
    FILE *stream = (FILE*)(uintptr_t)handle;
    if (fread(MEM + (u32)pointer.val + 8, 1, (size_t)length, stream) != (size_t)length) status = 1;
    if (fclose(stream) != 0) status = 1;
  }
  `
  if (status !== 0) throw new Error(`Cannot read file: ${path}`)
  return bytes
}

export function writeFile(path, bytes, force = false) {
  const filename = pathBytes(path)
  const pathPointer = Porffor.IR.ptr(filename.buffer)
  const pointer = Porffor.IR.ptr(bytes.buffer)
  const offset = bytes.byteOffset
  const length = bytes.byteLength
  const overwrite = force ? 1 : 0
  let status = 0
  Porffor.c`
  {
    FILE *stream = fopen((char*)MEM + (u32)pathPointer.val + 8, overwrite.val ? "wb" : "wbx");
    if (!stream) status = 1;
    else {
      if (fwrite(MEM + (u32)pointer.val + 8 + (u32)offset.val, 1, (size_t)length.val, stream) != (size_t)length.val) status = 1;
      if (fclose(stream) != 0) status = 1;
    }
  }
  `
  if (status !== 0)
    throw new Error(
      `Cannot write file: ${path} (use --force to overwrite an existing file)`
    )
}

export function exitFailure() {
  Porffor.c`exit(1);`
}
