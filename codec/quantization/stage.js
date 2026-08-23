/**
 * Carta1 quantization stage.
 */

import { WORD_LENGTH_BITS } from '../core/tables.js'
import { quantize as quantizeCoefficient } from './spectrum.js'

/**
 * Materialize retained allocation as quantized ATRAC1 symbols.
 *
 * @returns {QuantizeFrame}
 */
export function quantize() {
  /**
   * @param {object} input
   * @returns {object}
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
