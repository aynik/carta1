/** UTF-8 host primitives used by the native executable's AEA boundary. */
export class NativeTextEncoder {
  encode(input = '') {
    const source = String(input)
    const bytes = new Uint8Array(source.length * 3)
    const { written } = this.encodeInto(source, bytes)
    return bytes.slice(0, written)
  }

  encodeInto(source, destination) {
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
      const size =
        point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4
      if (written + size > destination.length) break
      if (size === 1) destination[written++] = point
      else {
        destination[written++] =
          size === 2
            ? 0xc0 | (point >> 6)
            : size === 3
              ? 0xe0 | (point >> 12)
              : 0xf0 | (point >> 18)
        if (size === 4) destination[written++] = 0x80 | ((point >> 12) & 63)
        if (size >= 3) destination[written++] = 0x80 | ((point >> 6) & 63)
        destination[written++] = 0x80 | (point & 63)
      }
      read += units
    }
    return { read, written }
  }
}

export class NativeTextDecoder {
  decode(input = new Uint8Array(0)) {
    const bytes = ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input)
    let result = ''
    let offset = 0
    let first = true
    while (offset < bytes.length) {
      const lead = bytes[offset++]
      let point = lead
      let count = 0
      let lower = 0x80
      let upper = 0xbf
      if (lead >= 0xc2 && lead <= 0xdf) {
        point = lead & 31
        count = 1
      } else if (lead >= 0xe0 && lead <= 0xef) {
        point = lead & 15
        count = 2
        if (lead === 0xe0) lower = 0xa0
        if (lead === 0xed) upper = 0x9f
      } else if (lead >= 0xf0 && lead <= 0xf4) {
        point = lead & 7
        count = 3
        if (lead === 0xf0) lower = 0x90
        if (lead === 0xf4) upper = 0x8f
      } else if (lead >= 0x80) point = 0xfffd
      for (let index = 0; index < count; index++) {
        const byte = bytes[offset]
        if (offset === bytes.length || byte < lower || byte > upper) {
          point = 0xfffd
          break
        }
        offset++
        point = (point << 6) | (byte & 63)
        lower = 0x80
        upper = 0xbf
      }
      if (!(first && point === 0xfeff)) result += String.fromCodePoint(point)
      first = false
    }
    return result
  }
}
