import { describe, expect, it } from 'vitest'
import { NativeTextDecoder, NativeTextEncoder } from '../native/utf8.js'
import { stringifyInspection } from '../native/json.js'
import {
  parsePcmWave,
  pcmBytesToChannels,
  createPcmWave,
} from '../codec/boundary/pcm.js'
import {
  AudioProcessor,
  decodeAeaPcm,
  encodeAeaPcm,
  EncoderOptions,
} from '../codec/index.js'

describe('native host boundaries', () => {
  it('keeps complete-file and async stream bytes and sample bits equivalent', async () => {
    for (const count of [0, 1, 513, 1024]) {
      for (const channelCount of [1, 2]) {
        const channels = Array.from({ length: channelCount }, (_, channel) =>
          Float32Array.from(
            { length: count },
            (_, sample) =>
              (((sample * (73 + channel * 30)) % 65536) - 32768) / 65536
          )
        )
        const values = { fixedBlockModes: [2, 2, 3], allocationBias: 1.25 }
        const encoded = AudioProcessor.encodeStream(
          AudioProcessor.frameBufferToFrames(channels),
          { channelCount, encoderOptions: new EncoderOptions(values) }
        )
        const blob = await AudioProcessor.createAeaBlob(encoded, {
          title: 'equivalence',
          channelCount,
          sampleCount: count,
        })
        const bytes = await encodeAeaPcm(channels, {
          title: 'equivalence',
          ...values,
        })
        expect(bytes).toEqual(new Uint8Array(await blob.arrayBuffer()))
        const { info, frameData } = await AudioProcessor.parseAeaBlob(blob)
        const stream = AudioProcessor.decodeStream(
          AudioProcessor.deserializedFrameStream(frameData),
          info
        )
        const expected = AudioProcessor.assemblePcmFrames(
          await AudioProcessor.collectFrames(stream),
          channelCount
        )
        const decoded = await decodeAeaPcm(bytes)
        const actual = new Float32Array(count * channelCount)
        for (let sample = 0; sample < count; sample++) {
          for (let channel = 0; channel < channelCount; channel++)
            actual[sample * channelCount + channel] = decoded[channel][sample]
        }
        expect(new Uint32Array(actual.buffer)).toEqual(
          new Uint32Array(expected.buffer)
        )
      }
    }
  })
  it('matches UTF-8 encoding, replacement and fixed-width truncation', () => {
    for (const text of [
      '',
      'ASCII',
      '日本🎵é',
      '\ufefftitle',
      '\ud800x\udfff',
    ]) {
      const reference = new TextEncoder()
      const native = new NativeTextEncoder()
      expect(native.encode(text)).toEqual(reference.encode(text))
      for (let size = 0; size <= 16; size++) {
        const a = new Uint8Array(size)
        const b = new Uint8Array(size)
        expect(native.encodeInto(text, a)).toEqual(
          reference.encodeInto(text, b)
        )
        expect(a).toEqual(b)
      }
    }
  })

  it('matches UTF-8 decoding of valid, malformed and truncated fields', () => {
    const fixtures = [
      [0xef, 0xbb, 0xbf, 65],
      [0xed, 0xa0, 0x80],
      [0xf0, 0x90, 0x80],
      [0xc0, 0xaf],
      [0xe2, 0x82, 65],
      [0xf4, 0x90, 0x80, 0x80],
    ]
    for (let byte = 0; byte < 256; byte++) fixtures.push([byte])
    fixtures.push(Array.from(new TextEncoder().encode('日本🎵')))
    for (const fixture of fixtures) {
      const bytes = new Uint8Array(fixture)
      expect(new NativeTextDecoder().decode(bytes)).toBe(
        new TextDecoder().decode(bytes)
      )
      expect(
        new NativeTextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
      ).toBe(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes))
    }
  })

  it('preserves Unicode JSON strings with escaped and lone surrogate code units', () => {
    const data = {
      title: '日本🎵\ud800\n"\\',
      frames: [1, false, null],
      empty: {},
    }
    expect(JSON.parse(stringifyInspection(data))).toEqual(data)
  })

  it('reads PCM from a nonzero byte offset and rejects incomplete layouts', () => {
    const data = new Uint8Array([99, 0, 128, 255, 127, 99])
    const channels = pcmBytesToChannels(data.subarray(1, 5), 16, 1, 2)
    expect(Array.from(channels[0])).toEqual([-1, 32767 / 32768])
    const wav = createPcmWave([new Float32Array([0, -1, 1])])
    expect(parsePcmWave(wav).channels[0]).toEqual(
      new Float32Array([0, -1, 32767 / 32768])
    )
    expect(() => parsePcmWave(wav.subarray(0, wav.length - 1))).toThrow(
      /Truncated/
    )
    const invalid = wav.slice()
    new DataView(invalid.buffer).setUint16(32, 3, true)
    expect(() => parsePcmWave(invalid)).toThrow(/layout/)
  })
})
