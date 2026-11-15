import { describe, it, expect } from 'vitest'
import { findScaleFactor, solve } from '../codec/allocation/solve'
import { buildPerceptualMask } from '../codec/allocation/distortion'
import {
  FRAME_BITS,
  FRAME_OVERHEAD_BITS,
  BITS_PER_BFU_METADATA,
} from '../codec/core/constants'
import {
  BFU_AMOUNTS,
  SCALE_FACTORS,
  SPECS_PER_BFU,
  WORD_LENGTH_BITS,
} from '../codec/core/tables'

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

  it('allocates bits to a nonzero BFU with scale-factor index zero', () => {
    const bfuSizes = new Array(52).fill(8)
    const bfuData = createMockBfuData(bfuSizes, 0)
    bfuData[0].fill(SCALE_FACTORS[0] / 2)

    const { allocation, scaleFactorIndices } = solve(bfuData, bfuSizes, 52, 1)

    expect(scaleFactorIndices[0]).toBe(0)
    expect(allocation[0]).toBeGreaterThan(0)
    expect(allocation.slice(1).every((bits) => bits === 0)).toBe(true)
  })

  it('prioritizes the stronger BFU when scale-factor indices are both zero', () => {
    const bfuSizes = new Array(52).fill(16)
    const bfuData = createMockBfuData(bfuSizes, SCALE_FACTORS[0] / 1000)
    bfuData[0].fill(SCALE_FACTORS[0] / 2)

    const { allocation, scaleFactorIndices } = solve(bfuData, bfuSizes, 52, 1)

    expect(scaleFactorIndices.every((index) => index === 0)).toBe(true)
    expect(allocation[0]).toBeGreaterThan(Math.max(...allocation.slice(1)))
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

  it('shrinks active BFU ceiling for band-limited input and spends refunded metadata bits', () => {
    const bfuSizes = Array.from(SPECS_PER_BFU)
    const bfuData = createMockBfuData(bfuSizes, 0)
    for (let i = 0; i < BFU_AMOUNTS[0]; i++) {
      bfuData[i].fill(0.5)
    }

    const { bfuCount, allocation } = solve(
      bfuData,
      bfuSizes,
      52,
      1.0,
      [0, 0, 0]
    )

    expect(bfuCount).toBe(BFU_AMOUNTS[0])
    let usedSampleBits = 0
    for (let i = 0; i < bfuCount; i++) {
      usedSampleBits += WORD_LENGTH_BITS[allocation[i]] * bfuSizes[i]
    }
    const max52PayloadBudget =
      FRAME_BITS - FRAME_OVERHEAD_BITS - 52 * BITS_PER_BFU_METADATA
    expect(usedSampleBits).toBeGreaterThan(max52PayloadBudget)
  })

  it('isolates short-block simultaneous masking within matching time slices', () => {
    const bfuSizes = Array.from(SPECS_PER_BFU)
    const energies = new Float64Array(52)
    const maxAbs = new Float64Array(52)
    const mask = new Float64Array(52)

    // BFU 3 is short band-0 frequency group 0, slice 3.
    energies[3] = 1.0
    maxAbs[3] = 0.5

    buildPerceptualMask(energies, maxAbs, bfuSizes, 52, 1.0, 2, 2, 3, mask)

    // BFU 7 (fg=1, slice=3) shares slice 3; BFU 4 (fg=1, slice=0) does not.
    expect(mask[7]).toBeGreaterThan(mask[4] * 100)

    const bfuData = createMockBfuData(bfuSizes, 0)
    bfuData[3].fill(1.0)
    for (let i = 4; i < 8; i++) {
      bfuData[i].fill(0.01)
    }
    const { allocation } = solve(bfuData, bfuSizes, 52, 1.0, [2, 2, 3])
    expect(allocation[4]).toBeGreaterThanOrEqual(allocation[7])
  })

  it('refines scale factors downward when outer-bin rounding reduces MSE', () => {
    const bfuSizes = Array.from(SPECS_PER_BFU)
    const bfuData = createMockBfuData(bfuSizes, SCALE_FACTORS[20] * 0.5)
    bfuData[0][0] = SCALE_FACTORS[20] * 0.7938

    expect(findScaleFactor(bfuData[0], bfuSizes[0])).toBe(20)

    const { scaleFactorIndices } = solve(bfuData, bfuSizes, 52, 1.0, [0, 0, 0])
    expect(scaleFactorIndices[0]).toBe(19)
  })

  it('steers bit concentration continuously with allocationBias', () => {
    const bfuSizes = Array.from(SPECS_PER_BFU)
    const bfuData = createMockBfuData(bfuSizes, 0.08)
    for (let i = 0; i < 4; i++) {
      bfuData[i].fill(1.0)
    }

    const lowBias = solve(bfuData, bfuSizes, 52, 0.5, [0, 0, 0])
    const highBias = solve(bfuData, bfuSizes, 52, 2.0, [0, 0, 0])

    expect(highBias.allocation[0]).toBeGreaterThan(lowBias.allocation[0])
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
