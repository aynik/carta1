/**
 * Carta1 quantization stage.
 */

import { WORD_LENGTH_BITS } from '../core/tables.js'
import { quantize as quantizeCoefficient } from './spectrum.js'

/**
 * @typedef {Object} StructuredFrame
 * @property {number} nBfu Retained BFU count
 * @property {Int32Array} scaleFactorIndices Scale factor for each retained BFU
 * @property {Int32Array} wordLengthIndices Word length for each retained BFU
 * @property {Array<Int32Array>} quantizedCoefficients Quantized BFU symbols
 * @property {Array<number>} blockModes Transform mode for each band
 */

/**
 * @callback QuantizeFrame
 * @param {import('../allocation/stage.js').AllocationFrame} input
 * @returns {StructuredFrame}
 */

/**
 * Materialize retained allocation as quantized ATRAC1 symbols.
 *
 * @returns {QuantizeFrame}
 */
export function quantize() {
  /**
   * @param {import('../allocation/stage.js').AllocationFrame} input
   * @returns {StructuredFrame}
   */
  return (input) => {
    const {
      bfuData,
      bfuSizes,
      nBfu,
      scaleFactorIndices,
      wordLengthIndices,
      blockModes,
    } = input
    const quantizedCoefficients = []

    for (let bfu = 0; bfu < nBfu; bfu++) {
      const data = bfuData[bfu].subarray(0, bfuSizes[bfu])
      const bitsPerSample = WORD_LENGTH_BITS[wordLengthIndices[bfu]]
      quantizedCoefficients.push(
        quantizeCoefficient(data, scaleFactorIndices[bfu], bitsPerSample)
      )
    }

    return {
      nBfu,
      scaleFactorIndices,
      wordLengthIndices,
      quantizedCoefficients,
      blockModes,
    }
  }
}
