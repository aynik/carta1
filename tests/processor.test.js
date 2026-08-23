import { describe, it, expect } from 'vitest'
import { AudioProcessor } from '../codec/boundary/processor'
import { TEST_SIGNALS } from './testSignals'
import { SAMPLES_PER_FRAME, WAV_HEADER_SIZE } from '../codec/core/constants'
import { decodeAeaPcm, encodeAeaPcm } from '../codec/index'
import { createPcmWave } from '../codec/boundary/pcm'

describe('AudioProcessor', () => {
  async function* createMonoStream(frameCount) {
    for (let i = 0; i < frameCount; i++) {
      yield TEST_SIGNALS.sine(440, 44100, SAMPLES_PER_FRAME)
    }
  }

  async function* createStereoStream(frameCount) {
    for (let i = 0; i < frameCount; i++) {
      yield [
        TEST_SIGNALS.sine(440, 44100, SAMPLES_PER_FRAME),
        TEST_SIGNALS.sine(880, 44100, SAMPLES_PER_FRAME),
      ]
    }
  }

  describe('encodeStream', () => {
    it('should process a mono stream', async () => {
      const stream = createMonoStream(2)
      const encodedStream = AudioProcessor.encodeStream(stream, {
        channelCount: 1,
      })
      const frames = []
      for await (const frame of encodedStream) {
        frames.push(frame)
      }
      expect(frames.length).toBe(2)
    })

    it('should process a stereo stream independently', async () => {
      const stream = createStereoStream(2)
      const encodedStream = AudioProcessor.encodeStream(stream, {
        channelCount: 2,
      })
      const frames = []
      for await (const frame of encodedStream) {
        frames.push(frame)
      }
      expect(frames.length).toBe(4)
    })

    it('should reject frames outside the selected channel mode', async () => {
      async function* invalidStream() {
        yield []
      }

      const encoded = AudioProcessor.encodeStream(invalidStream(), {
        channelCount: 1,
      })
      await expect(AudioProcessor.collectFrames(encoded)).rejects.toThrow(
        '1 Float32 channel per frame'
      )
    })

    it.each([
      ['short mono', 1, new Float32Array(SAMPLES_PER_FRAME - 1)],
      ['long mono', 1, new Float32Array(SAMPLES_PER_FRAME + 1)],
      [
        'short stereo',
        2,
        [
          new Float32Array(SAMPLES_PER_FRAME - 1),
          new Float32Array(SAMPLES_PER_FRAME),
        ],
      ],
      [
        'long stereo',
        2,
        [
          new Float32Array(SAMPLES_PER_FRAME),
          new Float32Array(SAMPLES_PER_FRAME + 1),
        ],
      ],
    ])('should reject a %s frame', async (_, channelCount, frame) => {
      async function* invalidStream() {
        yield frame
      }

      const encoded = AudioProcessor.encodeStream(invalidStream(), {
        channelCount,
      })
      await expect(AudioProcessor.collectFrames(encoded)).rejects.toThrow(
        `exactly ${SAMPLES_PER_FRAME} samples per channel`
      )
    })
  })

  describe('decodeStream', () => {
    it('should apply delay compensation', async () => {
      const stream = createMonoStream(2)
      const encodedStream = AudioProcessor.encodeStream(stream, {
        channelCount: 1,
      })
      const decodedStream = AudioProcessor.decodeStream(encodedStream, {
        channelCount: 1,
      })
      const frames = []
      for await (const frame of decodedStream) {
        frames.push(frame)
      }
      // The number of frames might change due to delay compensation
      expect(frames.length).toBeGreaterThan(0)
    })
  })

  describe('frameBufferToFrames', () => {
    it('should correctly frame a buffer', () => {
      const buffer = new Float32Array(SAMPLES_PER_FRAME * 2.5)
      const frames = [...AudioProcessor.frameBufferToFrames([buffer])]
      expect(frames.length).toBe(3)
      expect(frames[0].length).toBe(SAMPLES_PER_FRAME)
      expect(frames[2].length).toBe(SAMPLES_PER_FRAME)
    })

    it('rejects mismatched channels and invalid frame sizes', () => {
      expect(() => [
        ...AudioProcessor.frameBufferToFrames([
          new Float32Array(2),
          new Float32Array(1),
        ]),
      ]).toThrow(/equally sized/)
      expect(() => [
        ...AudioProcessor.frameBufferToFrames([new Float32Array(2)], 0),
      ]).toThrow(/positive integer/)
    })
  })

  it('keeps PCM serialization byte-native below the Blob facade', () => {
    expect(createPcmWave([new Float32Array(1)])).toBeInstanceOf(Uint8Array)
  })

  describe('createAeaBlob and parseAeaBlob', () => {
    it('should perform a round-trip', async () => {
      const stream = createMonoStream(2)
      const encodedStream = AudioProcessor.encodeStream(stream, {
        channelCount: 1,
      })
      const blob = await AudioProcessor.createAeaBlob(encodedStream, {
        title: 'test',
      })
      const { info, frameData } = await AudioProcessor.parseAeaBlob(blob)

      expect(info.title).toBe('test')
      expect(info.frameCount).toBe(2)
      expect(frameData.length).toBe(2)
    })
  })

  describe('complete AEA helpers', () => {
    it('round-trips complete planar stereo buffers', async () => {
      const channels = [
        TEST_SIGNALS.sine(440, 44100, 700),
        TEST_SIGNALS.sine(880, 44100, 700),
      ]

      const aea = await encodeAeaPcm(channels, { title: 'complete helper' })
      const decoded = await decodeAeaPcm(aea)

      expect(aea).toBeInstanceOf(Uint8Array)
      expect(decoded).toHaveLength(2)
      expect(decoded[0]).toHaveLength(SAMPLES_PER_FRAME * 2)
      expect(decoded[1]).toHaveLength(SAMPLES_PER_FRAME * 2)
    })

    it('rejects unsupported PCM input', async () => {
      await expect(encodeAeaPcm([])).rejects.toThrow(
        'one or two Float32 channels'
      )
      await expect(decodeAeaPcm('not AEA bytes')).rejects.toThrow(
        'AEA bytes or a Blob'
      )
    })
  })

  describe('createWavBlob', () => {
    it('should create a valid WAV header', async () => {
      const frames = [new Float32Array(SAMPLES_PER_FRAME)]
      const blob = AudioProcessor.createWavBlob(frames)
      const buffer = await blob.arrayBuffer()
      const view = new DataView(buffer)
      expect(view.getUint32(0, false)).toBe(0x52494646) // RIFF
      expect(view.getUint32(8, false)).toBe(0x57415645) // WAVE
      expect(blob.size).toBe(WAV_HEADER_SIZE + SAMPLES_PER_FRAME * 2)
    })
  })
})
