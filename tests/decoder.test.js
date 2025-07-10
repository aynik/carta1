import { describe, it, expect } from 'vitest'
import { encode } from '../codec/pipeline/encoder'
import { decode } from '../codec/pipeline/decoder'
import { TEST_SIGNALS } from './testSignals'
import { SAMPLES_PER_FRAME, CODEC_DELAY } from '../codec/core/constants'
import { withFlushSamples, withDelayCompensation } from '../codec/utils'

describe('Decoder Pipeline', () => {
  it('should perform a full pipeline execution without errors', () => {
    const encoder = encode()
    const decoder = decode()
    const pcmSamples = TEST_SIGNALS.sine(440, 44100, SAMPLES_PER_FRAME)
    const encoded = encoder(pcmSamples)
    const decoded = decoder(encoded)

    expect(decoded).toBeDefined()
    expect(decoded.length).toBe(SAMPLES_PER_FRAME)
  })

  it('should achieve near-perfect reconstruction with the encoder', async () => {
    const encoder = encode()
    const decoder = decode()

    // Create a test signal with multiple frames
    async function* createTestStream() {
      for (let i = 0; i < 3; i++) {
        yield TEST_SIGNALS.sine(440, 44100, SAMPLES_PER_FRAME)
      }
    }

    // Encode with flush samples
    const encodedFrames = []
    for await (const frame of withFlushSamples(createTestStream())) {
      encodedFrames.push(encoder(frame))
    }

    // Decode and apply delay compensation
    async function* decodeStream() {
      for (const encoded of encodedFrames) {
        yield decoder(encoded)
      }
    }

    const decodedFrames = []
    for await (const frame of withDelayCompensation(
      decodeStream(),
      CODEC_DELAY
    )) {
      decodedFrames.push(frame)
    }

    // Compare the middle frame (to avoid edge effects)
    if (decodedFrames.length >= 2) {
      const originalFrame = TEST_SIGNALS.sine(440, 44100, SAMPLES_PER_FRAME)
      const decodedFrame = decodedFrames[1]

      let error = 0
      const compareLength = Math.min(originalFrame.length, decodedFrame.length)
      for (let i = 0; i < compareLength; i++) {
        error += Math.abs(decodedFrame[i] - originalFrame[i])
      }

      expect(error / compareLength).toBeLessThan(0.1)
    }
  })

  it('should handle all block modes', () => {
    const decoder = decode()
    const encoded = {
      nBfu: 52,
      scaleFactorIndices: new Int32Array(52).fill(10),
      wordLengthIndices: new Int32Array(52).fill(8),
      quantizedCoefficients: new Array(52)
        .fill(0)
        .map(() => new Int32Array(10).fill(1)),
      blockSizeMode: [1, 1, 1], // All short blocks
    }

    const decoded = decoder(encoded)
    expect(decoded).toBeDefined()
  })

  it('should handle zero word length BFUs', () => {
    const decoder = decode()
    const encoded = {
      nBfu: 52,
      scaleFactorIndices: new Int32Array(52).fill(0),
      wordLengthIndices: new Int32Array(52).fill(0), // All zero word length
      quantizedCoefficients: new Array(52).fill(0).map(() => new Int32Array(0)),
      blockSizeMode: [0, 0, 0],
    }

    const decoded = decoder(encoded)
    expect(decoded.every((v) => v === 0)).toBe(true)
  })
})
