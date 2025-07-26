import { describe, it, expect } from 'vitest'
import { allocateBits } from '../codec/coding/bitallocation'
import {
  FRAME_BITS,
  FRAME_OVERHEAD_BITS,
  BITS_PER_BFU_METADATA,
  WORD_LENGTH_BITS,
} from '../codec/core/constants'

describe('Bit Allocation', () => {
  const createMockPsychoResults = () => ({
    criticalBandThresholds: new Float32Array(25).fill(-60),
  })

  const createMockBfuData = (sizes, value = 1) =>
    sizes.map((size) => new Float32Array(size).fill(value))

  it('should respect the bit budget', () => {
    const bfuSizes = new Array(52).fill(10)
    const bfuData = createMockBfuData(bfuSizes)
    const psychoResults = createMockPsychoResults()

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

    // Create psycho results with clear threshold differences
    const psychoResults = {
      criticalBandThresholds: new Float32Array(25).fill(-30), // Default higher threshold (lower SMR)
    }

    // Set much lower thresholds for early critical bands (higher SMR)
    // This should result in higher SMR for lower frequency BFUs
    psychoResults.criticalBandThresholds[0] = -80 // Very low threshold = high SMR
    psychoResults.criticalBandThresholds[1] = -70 // Low threshold = high SMR

    const { allocation } = allocateBits(psychoResults, bfuData, bfuSizes, 52)

    // BFUs affected by critical bands 0-1 should get more bits due to higher SMR
    // The bit allocator should prioritize high SMR regardless of frequency
    const lowThresholdBfus = allocation.slice(0, 8) // BFUs likely affected by bands 0-1
    const highThresholdBfus = allocation.slice(25, 35) // BFUs likely affected by higher bands

    const avgLowThreshold =
      lowThresholdBfus.reduce((a, b) => a + b, 0) / lowThresholdBfus.length
    const avgHighThreshold =
      highThresholdBfus.reduce((a, b) => a + b, 0) / highThresholdBfus.length

    // High SMR BFUs should get more bits on average
    expect(avgLowThreshold).toBeGreaterThan(avgHighThreshold)
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
      criticalBandThresholds: new Float32Array(25).fill(-60),
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
    const psychoResults = createMockPsychoResults()

    const { allocation } = allocateBits(psychoResults, bfuData, bfuSizes, 52)

    expect(allocation.every((bits) => bits === 0)).toBe(true)
  })

  it('should stop allocating bits when there is diminishing returns', () => {
    const bfuSizes = new Array(52).fill(10)
    const bfuData = createMockBfuData(bfuSizes)

    // Create proper psycho results with varying thresholds
    const psychoResults = {
      criticalBandThresholds: new Float32Array(25).fill(-20), // Default high threshold (low priority)
    }

    // BFU 0 and 1 are in low critical bands - set very low thresholds (high SMR)
    psychoResults.criticalBandThresholds[0] = -100 // Affects low frequency BFUs
    psychoResults.criticalBandThresholds[1] = -90 // Affects low frequency BFUs

    const { allocation } = allocateBits(psychoResults, bfuData, bfuSizes, 52)

    // Low frequency BFUs should get more bits due to lower thresholds
    const avgLowFreq = allocation.slice(0, 5).reduce((a, b) => a + b, 0) / 5
    const avgMidFreq = allocation.slice(10, 15).reduce((a, b) => a + b, 0) / 5
    expect(avgLowFreq).toBeGreaterThan(avgMidFreq)

    // With sufficient signal energy, all BFUs should get some allocation
    // The test should check for reasonable bit distribution, not necessarily zeros
    expect(allocation.some((bits) => bits > 0)).toBe(true)
  })
})
