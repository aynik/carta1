/**
 * Carta1 Audio Codec - Spectrum Quantization
 *
 * This module handles the quantization and dequantization of MDCT frequency coefficients
 * for the Carta1 audio codec. It provides functions to convert floating-point frequency
 * domain data into integer representations suitable for bitstream encoding.
 *
 * The quantization process uses configurable scale factors to maintain audio quality
 * while achieving the target compression ratio. The module supports both uniform
 * and non-uniform quantization schemes based on perceptual importance.
 */

import { QUANTIZATION_SIGN_BIT_SHIFT } from '../core/constants.js'
import { SCALE_FACTORS } from '../core/tables.js'

/**
 * Quantize coefficients.
 * @param {Float32Array} coefficients
 * @param {number} scaleFactorIndex
 * @param {number} bitsPerSample
 * @returns {Int32Array} out
 */
export function quantize(coefficients, scaleFactorIndex, bitsPerSample) {
  const length = coefficients.length
  const out = new Int32Array(length)
  if (bitsPerSample === 0 || scaleFactorIndex === 0) {
    out.fill(0, 0, length)
    return out
  }

  const scaleFactor = SCALE_FACTORS[scaleFactorIndex]
  const quantRange = (1 << (bitsPerSample - QUANTIZATION_SIGN_BIT_SHIFT)) - 1
  const normFactor = quantRange / scaleFactor

  const hi = quantRange
  const lo = -quantRange

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
 * @returns {Float32Array}
 */
export function dequantize(quantized, scaleFactorIndex, bitsPerSample) {
  if (bitsPerSample === 0 || scaleFactorIndex === 0) {
    return new Float32Array(quantized.length)
  }

  const scaleFactor = SCALE_FACTORS[scaleFactorIndex]
  const quantRange = (1 << (bitsPerSample - QUANTIZATION_SIGN_BIT_SHIFT)) - 1

  const deq = new Float32Array(quantized.length)
  for (let i = 0; i < quantized.length; i++) {
    deq[i] = (quantized[i] * scaleFactor) / quantRange
  }
  return deq
}
