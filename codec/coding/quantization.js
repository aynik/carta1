/**
 * Carta1 Audio Codec - Quantization Module
 *
 * This module handles the quantization and dequantization of MDCT frequency coefficients
 * for the Carta1 audio codec. It provides functions to convert floating-point frequency
 * domain data into integer representations suitable for bitstream encoding.
 *
 * Key functions:
 * - Quantization of coefficients using scale factors and bit depths
 * - Dequantization for reconstruction during decoding
 * - BFU (Band Frequency Unit) organization for psychoacoustic processing
 *
 * The quantization process uses configurable scale factors to maintain audio quality
 * while achieving the target compression ratio. The module supports both uniform
 * and non-uniform quantization schemes based on perceptual importance.
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
 * Quantize coefficients.
 * @param {Float64Array} coefficients
 * @param {number} scaleFactorIndex
 * @param {number} bitsPerSample
 * @returns {Int32Array} out
 */
export function quantize(coefficients, scaleFactorIndex, bitsPerSample) {
  const length = coefficients.length
  const out = new Int32Array(length)
  if (bitsPerSample === 0 || scaleFactorIndex === 0) {
    // Zero fast path
    out.fill(0, 0, length)
    return out
  }

  const scaleFactor = SCALE_FACTORS[scaleFactorIndex]
  const quantRange = (1 << (bitsPerSample - QUANTIZATION_SIGN_BIT_SHIFT)) - 1
  const normFactor = quantRange / scaleFactor

  const hi = quantRange
  const lo = -quantRange - 1

  for (let i = 0; i < length; i++) {
    const x = coefficients[i] * normFactor
    const y = (x + (x >= 0 ? 0.5 : -0.5)) | 0
    out[i] = y > hi ? hi : y < lo ? lo : y
  }

  return out
}

/**
 * Dequantize coefficients.
 * @param {Int32Array} quantized
 * @param {number} scaleFactorIndex
 * @param {number} bitsPerSample
 * @returns {Float64Array}
 */
export function dequantize(quantized, scaleFactorIndex, bitsPerSample) {
  if (bitsPerSample === 0 || scaleFactorIndex === 0) {
    return new Float64Array(quantized.length)
  }

  const scaleFactor = SCALE_FACTORS[scaleFactorIndex]
  const quantRange = (1 << (bitsPerSample - QUANTIZATION_SIGN_BIT_SHIFT)) - 1
  const denormFactor = scaleFactor / quantRange

  const deq = new Float64Array(quantized.length)
  for (let i = 0; i < quantized.length; i++) {
    deq[i] = quantized[i] * denormFactor
  }
  return deq
}

/**
 * Groups MDCT coefficients into Band Frequency Units (BFUs) for bit allocation.
 *
 * This function organizes frequency-domain coefficients into perceptually meaningful
 * frequency bands (BFUs) based on the block modes for each of the three frequency bands.
 * It handles both long and short blocks, with different frequency resolutions and
 * BFU start positions for each block type.
 *
 * The function implements copy-avoidance optimization: when a BFU slice is fully
 * contained within a frequency band, it directly copies the data without buffer
 * filling. For BFUs that span band boundaries or extend beyond the available
 * coefficients, it handles partial copying and zero-padding appropriately.
 *
 * Frequency Band Structure:
 * - Band 0: 0-128 coefficients (low frequencies)
 * - Band 1: 128-256 coefficients (mid frequencies)
 * - Band 2: 256-512 coefficients (high frequencies)
 *
 * Block Types:
 * - Long blocks (mode 0): Higher frequency resolution, fewer temporal segments
 * - Short blocks (mode 1): Lower frequency resolution, more temporal segments
 *
 * @param {Float64Array} coefficients
 * @param {Array<number>} blockModes
 * @returns {{bfuData: Array<Float64Array>, bfuSizes: Array<number>, bfuCount: number}}
 */
export function groupIntoBFUs(coefficients, blockModes) {
  const bfuData = []
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
      const endPos = startPos + size
      const bfu = new Float64Array(size)

      if (startPos >= 0 && endPos <= bandSize) {
        bfu.set(coefficients.subarray(bandStart + startPos, bandStart + endPos))
      } else {
        bfu.fill(0)
        if (startPos < bandSize && endPos > 0) {
          const srcStart = Math.max(0, startPos)
          const srcEnd = Math.min(bandSize, endPos)
          bfu.set(
            coefficients.subarray(bandStart + srcStart, bandStart + srcEnd),
            Math.max(0, -startPos)
          )
        }
      }

      bfuData.push(bfu)
      bfuSizes.push(size)
      bfuIndex++
    }

    coeffIndex += bandSize
  }

  return { bfuData, bfuSizes, bfuCount: bfuIndex }
}
