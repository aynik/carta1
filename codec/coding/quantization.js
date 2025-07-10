/**
 * Carta1 Audio Codec - Quantization
 *
 * This module implements quantization and dequantization of MDCT coefficients
 * for the ATRAC1 audio codec, organizing coefficients into Block Floating Units (BFUs)
 * and applying appropriate scale factors for optimal bit allocation.
 */

import {
  SPECS_PER_BFU,
  BFU_START_LONG,
  BFU_START_SHORT,
  BFU_BAND_BOUNDARIES,
  SCALE_FACTORS,
  QUANTIZATION_SIGN_BIT_SHIFT,
} from '../core/constants.js'

/**
 * Find the optimal scale factor index for a set of coefficients
 * @param {Float32Array} coefficients - MDCT coefficients to analyze
 * @returns {number} Scale factor index (0-63)
 */
export function findScaleFactor(coefficients) {
  let maxAmplitude = 0

  for (let i = 0; i < coefficients.length; i++) {
    maxAmplitude = Math.max(maxAmplitude, Math.abs(coefficients[i]))
  }

  if (maxAmplitude === 0) return 0

  // Binary search for optimal scale factor
  let low = 0
  let high = SCALE_FACTORS.length - 1

  while (low < high) {
    const mid = (low + high) >> 1
    if (maxAmplitude <= SCALE_FACTORS[mid]) {
      high = mid
    } else {
      low = mid + 1
    }
  }

  return low
}

/**
 * Quantize floating-point coefficients to integer values
 * @param {Float32Array} coefficients - Input coefficients to quantize
 * @param {number} scaleFactorIndex - Index into SCALE_FACTORS table
 * @param {number} bitsPerSample - Number of bits per quantized sample
 * @returns {Int32Array} Quantized integer coefficients
 */
export function quantize(coefficients, scaleFactorIndex, bitsPerSample) {
  if (bitsPerSample === 0 || scaleFactorIndex === 0) {
    return new Int32Array(coefficients.length)
  }

  const scaleFactor = SCALE_FACTORS[scaleFactorIndex]
  const quantRange = (1 << (bitsPerSample - QUANTIZATION_SIGN_BIT_SHIFT)) - 1
  const normFactor = quantRange / scaleFactor

  const quantized = new Int32Array(coefficients.length)

  for (let i = 0; i < coefficients.length; i++) {
    const normalized = coefficients[i] * normFactor
    quantized[i] = Math.max(
      -quantRange - 1,
      Math.min(quantRange, Math.round(normalized))
    )
  }

  return quantized
}

/**
 * Dequantize integer coefficients back to floating-point values
 * @param {Int32Array} quantized - Quantized integer coefficients
 * @param {number} scaleFactorIndex - Index into SCALE_FACTORS table
 * @param {number} bitsPerSample - Number of bits per quantized sample
 * @returns {Float32Array} Dequantized floating-point coefficients
 */
export function dequantize(quantized, scaleFactorIndex, bitsPerSample) {
  if (bitsPerSample === 0 || scaleFactorIndex === 0) {
    return new Float32Array(quantized.length)
  }

  const scaleFactor = SCALE_FACTORS[scaleFactorIndex]
  const quantRange = (1 << (bitsPerSample - QUANTIZATION_SIGN_BIT_SHIFT)) - 1
  const denormFactor = scaleFactor / quantRange

  const dequantized = new Float32Array(quantized.length)

  for (let i = 0; i < quantized.length; i++) {
    dequantized[i] = quantized[i] * denormFactor
  }

  return dequantized
}

/**
 * Group MDCT coefficients into Block Floating Units (BFUs)
 * @param {Float32Array} coefficients - Input MDCT coefficients
 * @param {number[]} blockModes - Block mode for each band (0=long, 1=short)
 * @param {Array<Float32Array>} bfuBuffers - Optional pre-allocated BFU buffers
 * @returns {Object} Object containing bfuData, bfuSizes, and bfuCount
 */
export function groupIntoBFUs(coefficients, blockModes, bfuBuffers = null) {
  const bfuData = bfuBuffers ?? []
  const bfuSizes = []

  let coeffIndex = 0
  let bfuIndex = 0

  for (let band = 0; band < 3; band++) {
    const bandStart = coeffIndex
    const bandSize = band === 2 ? 256 : 128
    const bandEnd = band < 2 ? BFU_BAND_BOUNDARIES[band] : SPECS_PER_BFU.length
    const isLongBlock = blockModes[band] === 0
    const startPositions = isLongBlock ? BFU_START_LONG : BFU_START_SHORT

    while (bfuIndex < bandEnd) {
      const size = SPECS_PER_BFU[bfuIndex]
      const startPos = startPositions[bfuIndex] - bandStart

      const bfu = bfuBuffers ? bfuBuffers[bfuIndex] : new Float32Array(size)
      bfu.fill(0) // Clear the buffer

      if (startPos >= 0 && startPos < bandSize) {
        const endPos = Math.min(startPos + size, bandSize)
        const actualSize = endPos - startPos

        for (let i = 0; i < actualSize; i++) {
          bfu[i] = coefficients[bandStart + startPos + i]
        }
      }

      if (!bfuBuffers) {
        bfuData.push(bfu)
      }
      bfuSizes.push(size)
      bfuIndex++
    }

    coeffIndex += bandSize
  }

  return { bfuData, bfuSizes, bfuCount: bfuIndex }
}
