import { describe, it, expect } from 'vitest'
import { encode } from '../codec/pipeline/encoder'
import { EncoderOptions } from '../codec/core/options'
import { TEST_SIGNALS } from './testSignals'
import {
  SAMPLES_PER_FRAME,
  FRAME_BITS,
  FRAME_OVERHEAD_BITS,
  BITS_PER_BFU_METADATA,
  WORD_LENGTH_BITS,
} from '../codec/core/constants'

describe('Encoder Pipeline', () => {
  it('should perform a full pipeline execution without errors', () => {
    const encoder = encode()
    const pcmSamples = TEST_SIGNALS.sine(440, 44100, SAMPLES_PER_FRAME)
    const result = encoder(pcmSamples)

    expect(result).toBeDefined()
    expect(result.nBfu).toBeGreaterThan(0)
    expect(result.scaleFactorIndices).toBeDefined()
    expect(result.wordLengthIndices).toBeDefined()
    expect(result.quantizedCoefficients).toBeDefined()
  })

  it('should use short blocks when a transient is detected', () => {
    // Simple test: silence followed by loud burst should trigger
    const options = new EncoderOptions({
      transientThresholdLow: 1,
      transientThresholdMid: 1.5,
      transientThresholdHigh: 2,
    })

    const encoder = encode(options)

    // Frame 1: Complete silence to establish zero baseline
    const silentFrame = new Float32Array(SAMPLES_PER_FRAME)
    encoder(silentFrame)

    // Frame 2: Still silent
    encoder(silentFrame)

    // Frame 3: VERY loud low-frequency burst to maximize spectral flux
    // Focus on low band (0-5.5kHz) for easier triggering
    const transientFrame = new Float32Array(SAMPLES_PER_FRAME)

    // Create a massive low-frequency burst
    // Use multiple low-frequency components for maximum energy
    for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
      // Kick drum frequencies (50-150 Hz)
      transientFrame[i] = 0.8 * Math.sin((2 * Math.PI * 60 * i) / 44100)
      transientFrame[i] += 0.7 * Math.sin((2 * Math.PI * 80 * i) / 44100)
      transientFrame[i] += 0.6 * Math.sin((2 * Math.PI * 100 * i) / 44100)
      transientFrame[i] += 0.5 * Math.sin((2 * Math.PI * 120 * i) / 44100)

      // Add some mid-low frequencies (150-500 Hz)
      transientFrame[i] += 0.4 * Math.sin((2 * Math.PI * 200 * i) / 44100)
      transientFrame[i] += 0.3 * Math.sin((2 * Math.PI * 300 * i) / 44100)
      transientFrame[i] += 0.3 * Math.sin((2 * Math.PI * 400 * i) / 44100)
      transientFrame[i] += 0.2 * Math.sin((2 * Math.PI * 500 * i) / 44100)

      // Add harmonics up to 5kHz (still in low band)
      for (let freq = 600; freq < 5000; freq += 200) {
        transientFrame[i] += 0.1 * Math.sin((2 * Math.PI * freq * i) / 44100)
      }
    }

    // Normalize to maximum safe amplitude
    let maxAmp = 0
    for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
      maxAmp = Math.max(maxAmp, Math.abs(transientFrame[i]))
    }
    for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
      transientFrame[i] = (transientFrame[i] * 0.95) / maxAmp
    }

    // This frame has MASSIVE spectral flux compared to silence
    const result = encoder(transientFrame)

    // Check if this frame or the next one uses short blocks
    let usesShortBlocks = result.blockSizeMode.some((mode) => mode !== 0)

    if (!usesShortBlocks) {
      // Sometimes the short blocks appear in the next frame
      const nextResult = encoder(silentFrame)
      usesShortBlocks = nextResult.blockSizeMode.some((mode) => mode !== 0)
    }

    // With lower thresholds, the transient should trigger short blocks
    expect(usesShortBlocks).toBe(true)
  })

  it('should stay within the bit budget', () => {
    const encoder = encode()
    const pcmSamples = TEST_SIGNALS.whiteNoise(1, SAMPLES_PER_FRAME)
    const result = encoder(pcmSamples)

    const overhead = FRAME_OVERHEAD_BITS + result.nBfu * BITS_PER_BFU_METADATA
    let usedBits = 0
    for (let i = 0; i < result.nBfu; i++) {
      usedBits +=
        WORD_LENGTH_BITS[result.wordLengthIndices[i]] *
        result.quantizedCoefficients[i].length
    }

    expect(usedBits + overhead).toBeLessThanOrEqual(FRAME_BITS)
  })

  it('should handle silent input gracefully', () => {
    const encoder = encode()
    const pcmSamples = TEST_SIGNALS.silence(SAMPLES_PER_FRAME)
    const result = encoder(pcmSamples)

    expect(result).toBeDefined()
    // For silence, we expect very few (or zero) bits to be allocated
    const totalBits = result.wordLengthIndices.reduce((sum, wl, i) => {
      return sum + WORD_LENGTH_BITS[wl] * result.quantizedCoefficients[i].length
    }, 0)
    expect(totalBits).toBe(0)
  })
})
