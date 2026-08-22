import { describe, it, expect } from 'vitest'
import { findScaleFactor, solve } from '../codec/allocation/solve'
import {
  FRAME_BITS,
  FRAME_OVERHEAD_BITS,
  BITS_PER_BFU_METADATA,
  WORD_LENGTH_BITS,
  SCALE_FACTORS,
} from '../codec/core/constants'

describe('RDO Bit Allocation', () => {
  const createMockBfuData = (sizes, value = 1) =>
    sizes.map((size) => new Float32Array(size).fill(value))

  it('should respect the bit budget', () => {
    const bfuSizes = new Array(52).fill(10)
    const bfuData = createMockBfuData(bfuSizes)

    const { bfuCount, allocation } = solve(bfuData, bfuSizes, 52, 1.0)

    const overhead = FRAME_OVERHEAD_BITS + bfuCount * BITS_PER_BFU_METADATA
    let usedBits = 0
    for (let i = 0; i < bfuCount; i++) {
      usedBits += WORD_LENGTH_BITS[allocation[i]] * bfuSizes[i]
    }

    expect(usedBits + overhead).toBeLessThanOrEqual(FRAME_BITS)
  })

  it('should use maximum BFU count in RDO mode for mock data', () => {
    const bfuSizes = new Array(52).fill(10)
    const bfuData = createMockBfuData(bfuSizes)

    const { bfuCount } = solve(bfuData, bfuSizes, 52, 1.0)
    expect(bfuCount).toBe(52)
  })

  it('should handle all-silent input', () => {
    const bfuSizes = new Array(52).fill(10)
    const bfuData = createMockBfuData(bfuSizes, 0)

    const { allocation } = solve(bfuData, bfuSizes, 52, 1.0)

    // With no signal, all allocations should be 0
    expect(allocation.every((bits) => bits === 0)).toBe(true)
  })

  it('should allocate more bits to BFUs with higher energy', () => {
    const bfuSizes = new Array(52).fill(10)
    const bfuData = []

    // Create BFU data with varying energy levels
    for (let i = 0; i < 52; i++) {
      if (i < 5) {
        bfuData.push(new Float32Array(10).fill(2.0)) // High energy
      } else if (i < 10) {
        bfuData.push(new Float32Array(10).fill(1.0)) // Medium energy
      } else {
        bfuData.push(new Float32Array(10).fill(0.1)) // Low energy
      }
    }

    const { allocation } = solve(bfuData, bfuSizes, 52, 1.0)

    // High energy BFUs should get more bits than low energy BFUs
    const avgHighEnergy = allocation.slice(0, 5).reduce((a, b) => a + b, 0) / 5
    const avgLowEnergy = allocation.slice(10, 15).reduce((a, b) => a + b, 0) / 5

    expect(avgHighEnergy).toBeGreaterThan(avgLowEnergy)
  })

  it('should return scale factor indices when using RDO', () => {
    const bfuSizes = new Array(52).fill(10)
    const bfuData = createMockBfuData(bfuSizes)

    const { scaleFactorIndices } = solve(bfuData, bfuSizes, 52, 1.0)
    expect(scaleFactorIndices).toBeDefined()
  })
})

describe('findScaleFactor', () => {
  it('should select the optimal scale factor', () => {
    // Test with coefficients that fit within the scale factor range
    const coeffs = new Float32Array([0.01, 0.05, 0.1, 0.2])
    const sfIndex = findScaleFactor(coeffs, coeffs.length)
    const maxAmplitude = 0.2

    // The selected scale factor should be the smallest one >= maxAmplitude
    expect(SCALE_FACTORS[sfIndex]).toBeGreaterThanOrEqual(maxAmplitude)
    if (sfIndex > 0) {
      expect(SCALE_FACTORS[sfIndex - 1]).toBeLessThan(maxAmplitude)
    }
  })

  it('should return 0 for all-zero input', () => {
    const coeffs = new Float32Array([0, 0, 0, 0])
    const sfIndex = findScaleFactor(coeffs, coeffs.length)
    expect(sfIndex).toBe(0)
  })
})
