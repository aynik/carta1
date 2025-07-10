import { describe, it, expect } from 'vitest'
import { allocateBits } from '../codec/coding/bitallocation'
import {
  FRAME_BITS,
  FRAME_OVERHEAD_BITS,
  BITS_PER_BFU_METADATA,
  WORD_LENGTH_BITS,
  SAMPLE_RATE,
  BFU_FREQUENCIES,
} from '../codec/core/constants'

describe('Bit Allocation', () => {
  const createMockPsychoResults = (smrValues) => ({
    globalThreshold: new Float32Array(smrValues.length).fill(0),
    maskingThreshold: new Float32Array(smrValues.map((smr) => 50 - smr)),
  })

  const createMockBfuData = (sizes, value = 1) =>
    sizes.map((size) => new Float32Array(size).fill(value))

  it('should respect the bit budget', () => {
    const bfuSizes = new Array(52).fill(10)
    const bfuData = createMockBfuData(bfuSizes)
    const psychoResults = createMockPsychoResults(new Array(52).fill(20))

    const { bfuCount, allocation } = allocateBits(
      psychoResults,
      bfuData,
      bfuSizes,
      52
    )

    const overhead = FRAME_OVERHEAD_BITS + bfuCount * BITS_PER_BFU_METADATA
    let usedBits = 0
    for (let i = 0; i < bfuCount; i++) {
      usedBits += WORD_LENGTH_BITS[allocation[i]] * bfuSizes[i]
    }

    expect(usedBits + overhead).toBeLessThanOrEqual(FRAME_BITS)
  })

  it('should prioritize high SMR BFUs', () => {
    const bfuSizes = new Array(52).fill(10)
    const bfuData = createMockBfuData(bfuSizes)

    // Create psycho results with clear SMR differences
    // The algorithm expects maskingThreshold in actual threshold values, not SMR
    const psychoResults = {
      maskingThreshold: new Float32Array(1025), // Typical FFT size / 2 + 1
      globalThreshold: new Float32Array(1025),
    }

    // Set a high threshold everywhere (low masking = more audible)
    psychoResults.maskingThreshold.fill(-50)

    // BFU 10 has center frequency 2928.5 Hz
    // With FFT size 2048 and sample rate 44100, freq per bin = 44100/2048 = 21.53 Hz
    // BFU 10 maps to bin: 2928.5 / 21.53 ≈ 136
    const freqPerBin = SAMPLE_RATE / 2048
    const bfu10Bin = Math.round(BFU_FREQUENCIES[10] / freqPerBin)

    // Set lower threshold around BFU 10's frequency (higher SMR)
    for (let i = bfu10Bin - 5; i <= bfu10Bin + 5; i++) {
      if (i >= 0 && i < psychoResults.maskingThreshold.length) {
        psychoResults.maskingThreshold[i] = -80 // Much lower threshold
      }
    }

    const { allocation } = allocateBits(psychoResults, bfuData, bfuSizes, 52)

    // BFU 10 should get more bits due to higher SMR
    expect(allocation[10]).toBeGreaterThan(allocation[0])
  })

  it('should select an optimal BFU count', () => {
    const bfuSizes = new Array(52).fill(10)
    // Create BFU data with signal only in first 25 BFUs
    const bfuData = []
    for (let i = 0; i < 52; i++) {
      if (i < 25) {
        bfuData.push(new Float32Array(10).fill(1.0)) // Signal
      } else {
        bfuData.push(new Float32Array(10).fill(0.0)) // No signal
      }
    }

    // Create proper psycho results
    const psychoResults = {
      maskingThreshold: new Float32Array(1025).fill(-60),
      globalThreshold: new Float32Array(1025).fill(-60),
    }

    const { bfuCount } = allocateBits(psychoResults, bfuData, bfuSizes, 52)

    // Should select a BFU count that covers the signal
    // BFU_AMOUNTS = [20, 28, 32, 36, 40, 44, 48, 52]
    // With signal in first 25 BFUs, should select 28
    expect(bfuCount).toBe(28)
  })

  it('should handle all-silent input', () => {
    const bfuSizes = new Array(52).fill(10)
    const bfuData = createMockBfuData(bfuSizes, 0)
    const psychoResults = createMockPsychoResults(new Array(52).fill(0))

    const { allocation } = allocateBits(psychoResults, bfuData, bfuSizes, 52)

    expect(allocation.every((bits) => bits === 0)).toBe(true)
  })

  it('should stop allocating bits when there is diminishing returns', () => {
    const bfuSizes = new Array(52).fill(10)
    const bfuData = createMockBfuData(bfuSizes)

    // Create proper psycho results with varying thresholds
    const psychoResults = {
      maskingThreshold: new Float32Array(1025),
      globalThreshold: new Float32Array(1025),
    }

    // Set default high threshold (low priority)
    psychoResults.maskingThreshold.fill(-20)

    // BFU 0 and 1 get much lower thresholds (high priority)
    const freqPerBin = SAMPLE_RATE / 2048
    const bfu0Bin = Math.round(BFU_FREQUENCIES[0] / freqPerBin)
    const bfu1Bin = Math.round(BFU_FREQUENCIES[1] / freqPerBin)

    // Set very low thresholds for BFUs 0 and 1 (high SMR)
    for (let i = bfu0Bin - 3; i <= bfu0Bin + 3; i++) {
      if (i >= 0 && i < psychoResults.maskingThreshold.length) {
        psychoResults.maskingThreshold[i] = -100
      }
    }
    for (let i = bfu1Bin - 3; i <= bfu1Bin + 3; i++) {
      if (i >= 0 && i < psychoResults.maskingThreshold.length) {
        psychoResults.maskingThreshold[i] = -90
      }
    }

    const { allocation } = allocateBits(psychoResults, bfuData, bfuSizes, 52)

    // High SMR BFUs should get more bits
    expect(allocation[0]).toBeGreaterThan(allocation[2])
    expect(allocation[1]).toBeGreaterThan(allocation[2])
    // And some BFUs should get no bits due to limited bit budget
    expect(allocation.some((bits) => bits === 0)).toBe(true)
  })
})
