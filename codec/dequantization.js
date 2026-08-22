/**
 * Carta1 dequantization stage.
 */

import {
  BFU_BAND_BOUNDARIES,
  BFU_START_LONG,
  BFU_START_SHORT,
  WORD_LENGTH_BITS,
} from './core/tables.js'
import { dequantize as dequantizeCoefficient } from './quantization/spectrum.js'

/**
 * @typedef {Object} DequantizedFrame
 * @property {Float32Array} coefficients Reconstructed ATRAC1 spectrum
 * @property {Array<number>} blockModes Transform mode for each band
 */

/**
 * @callback DequantizeFrame
 * @param {import('./quantization/stage.js').StructuredFrame} frameData
 * @returns {DequantizedFrame}
 */

/**
 * Reconstruct the continuous ATRAC1 spectrum.
 *
 * @returns {DequantizeFrame}
 */
export function dequantize() {
  /**
   * @param {import('./quantization/stage.js').StructuredFrame} frameData
   * @returns {DequantizedFrame}
   */
  return (frameData) => {
    const coefficients = new Float32Array(512)
    const {
      nBfu,
      scaleFactorIndices,
      wordLengthIndices,
      quantizedCoefficients,
      blockModes,
    } = frameData

    for (let bfu = 0; bfu < nBfu; bfu++) {
      const bitsPerSample = WORD_LENGTH_BITS[wordLengthIndices[bfu]]
      let band = 0
      if (bfu >= BFU_BAND_BOUNDARIES[0]) band = 1
      if (bfu >= BFU_BAND_BOUNDARIES[1]) band = 2

      const position =
        blockModes[band] === 0 ? BFU_START_LONG[bfu] : BFU_START_SHORT[bfu]

      if (bitsPerSample > 0) {
        const dequantized = dequantizeCoefficient(
          quantizedCoefficients[bfu],
          scaleFactorIndices[bfu],
          bitsPerSample
        )
        coefficients.set(dequantized, position)
      }
    }

    return { coefficients, blockModes }
  }
}
