import { describe, it, expect } from 'vitest'
import { AudioProcessor } from '../codec/io/processor'
import { TEST_SIGNALS } from './testSignals'
import { SAMPLES_PER_FRAME, WAV_HEADER_SIZE } from '../codec/core/constants'

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
      // withFlushSamples adds an extra frame for codec delay
      expect(frames.length).toBe(3)
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
      // 2 input frames + 1 flush frame = 3 frames per channel
      // 3 left frames + 3 right frames = 6 total (interleaved)
      expect(frames.length).toBe(6)
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
      // 2 input frames + 1 flush frame = 3 total frames
      expect(info.frameCount).toBe(3)
      expect(frameData.length).toBe(3)
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
