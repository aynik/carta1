import { describe, it, expect } from 'vitest'
import {
  findScaleFactor,
  quantize,
  dequantize,
  groupIntoBFUs,
} from '../codec/coding/quantization'
import { SCALE_FACTORS } from '../codec/core/constants'

describe('Quantization', () => {
  describe('findScaleFactor', () => {
    it('should select the optimal scale factor', () => {
      // Test with coefficients that fit within the scale factor range
      const coeffs = new Float32Array([0.01, 0.05, 0.1, 0.2])
      const sfIndex = findScaleFactor(coeffs)
      const maxAmplitude = 0.2

      // The selected scale factor should be the smallest one >= maxAmplitude
      expect(SCALE_FACTORS[sfIndex]).toBeGreaterThanOrEqual(maxAmplitude)
      if (sfIndex > 0) {
        expect(SCALE_FACTORS[sfIndex - 1]).toBeLessThan(maxAmplitude)
      }
    })

    it('should return 0 for all-zero input', () => {
      const coeffs = new Float32Array([0, 0, 0, 0])
      const sfIndex = findScaleFactor(coeffs)
      expect(sfIndex).toBe(0)
    })
  })

  describe('quantize and dequantize', () => {
    it('should perform a round-trip with acceptable error', () => {
      // Use coefficients within the scale factor range (max 1.0)
      const coeffs = new Float32Array([0.123, -0.456, 0.789, -0.95])
      const sfIndex = findScaleFactor(coeffs)
      const bits = 8

      const quantized = quantize(coeffs, sfIndex, bits)
      const dequantized = dequantize(quantized, sfIndex, bits)

      // Calculate expected quantization error
      const scaleFactor = SCALE_FACTORS[sfIndex]
      const quantRange = (1 << (bits - 1)) - 1
      const quantizationStep = scaleFactor / quantRange

      for (let i = 0; i < coeffs.length; i++) {
        const error = Math.abs(dequantized[i] - coeffs[i])
        // Error should be less than one quantization step
        expect(error).toBeLessThan(quantizationStep)
      }
    })

    it('should handle zero input', () => {
      const coeffs = new Float32Array(4).fill(0)
      const quantized = quantize(coeffs, 10, 8)
      expect(quantized.every((v) => v === 0)).toBe(true)
    })

    it('should clip values outside the quantization range', () => {
      const bits = 4
      const quantRange = (1 << (bits - 1)) - 1
      const coeffs = new Float32Array([100, -100]) // Values that will exceed the range
      const sfIndex = 10

      const quantized = quantize(coeffs, sfIndex, bits)
      expect(quantized[0]).toBe(quantRange)
      expect(quantized[1]).toBe(-quantRange - 1)
    })
  })

  describe('groupIntoBFUs', () => {
    it('should correctly map coefficients in long block mode', () => {
      const coeffs = new Float32Array(512)
      for (let i = 0; i < 512; i++) coeffs[i] = i
      const blockModes = [0, 0, 0] // All long

      const { bfuData } = groupIntoBFUs(coeffs, blockModes)

      let totalSum = 0
      bfuData.forEach((bfu) => (totalSum += bfu.reduce((s, v) => s + v, 0)))
      const originalSum = coeffs.reduce((s, v) => s + v, 0)

      expect(totalSum).toBeCloseTo(originalSum)
      expect(bfuData[0][0]).toBe(0)
      expect(bfuData[1][0]).toBe(8)
    })

    it('should handle different block modes', () => {
      const coeffs = new Float32Array(512)
      for (let i = 0; i < 512; i++) coeffs[i] = i
      const blockModes = [1, 0, 1] // Mixed modes

      const { bfuData } = groupIntoBFUs(coeffs, blockModes)

      let totalSum = 0
      bfuData.forEach((bfu) => (totalSum += bfu.reduce((s, v) => s + v, 0)))
      const originalSum = coeffs.reduce((s, v) => s + v, 0)

      expect(totalSum).toBeCloseTo(originalSum)
    })
  })
})
