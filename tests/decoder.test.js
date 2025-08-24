import { describe, it, expect } from 'vitest'
import { encode } from '../codec/pipeline/encoder'
import { decode } from '../codec/pipeline/decoder'
import { TEST_SIGNALS } from './testSignals'
import { SAMPLES_PER_FRAME } from '../codec/core/constants'

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
    const CODEC_DELAY = 266

    // Create a test signal with multiple frames
    async function* createTestStream() {
      for (let i = 0; i < 5; i++) {
        yield TEST_SIGNALS.sine(440, 44100, SAMPLES_PER_FRAME)
      }
    }

    // Encode all frames
    const encodedFrames = []
    for await (const frame of createTestStream()) {
      encodedFrames.push(encoder(frame))
    }

    // Decode all frames
    const decodedFrames = []
    for (const encoded of encodedFrames) {
      decodedFrames.push(decoder(encoded))
    }

    // Concatenate original and decoded frames
    const originalConcat = []
    const decodedConcat = []

    for (let i = 0; i < 5; i++) {
      const frame = TEST_SIGNALS.sine(440, 44100, SAMPLES_PER_FRAME)
      originalConcat.push(...frame)
    }

    for (const frame of decodedFrames) {
      decodedConcat.push(...frame)
    }

    // Compare with delay compensation
    const compareLength = Math.min(
      originalConcat.length - CODEC_DELAY,
      decodedConcat.length - CODEC_DELAY
    )
    let error = 0

    for (let i = 0; i < compareLength; i++) {
      error += Math.abs(decodedConcat[i + CODEC_DELAY] - originalConcat[i])
    }

    expect(error / compareLength).toBeLessThan(0.1)
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
      blockModes: [1, 1, 1], // All short blocks
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
      blockModes: [0, 0, 0],
    }

    const decoded = decoder(encoded)
    expect(decoded.every((v) => v === 0)).toBe(true)
  })
})
