/**
 * Carta1 Audio Codec - Encoding Pipeline
 *
 * The frame pipeline reads as analysis, allocation, then quantization. Byte
 * packing remains the responsibility of serializeFrame().
 */

import { allocate } from '../allocation/stage.js'
import { analyze } from '../analysis/stage.js'
import { quantize as quantizeCoefficient } from '../coding/quantization.js'
import { BufferPool } from '../core/buffers.js'
import { WORD_LENGTH_BITS } from '../core/constants.js'
import { EncoderOptions } from '../core/options.js'
import { pipe } from '../utils.js'

/**
 * Materialize retained allocation as quantized ATRAC1 symbols.
 *
 * @returns {Function}
 */
export function quantize() {
  /**
   * @param {Object} input
   * @returns {Object}
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

/**
 * Create an ATRAC1 encoder.
 *
 * @param {EncoderOptions} [options=new EncoderOptions()]
 * @param {BufferPool} [bufferPool=new BufferPool()]
 * @returns {Function}
 */
export function encode(
  options = new EncoderOptions(),
  bufferPool = new BufferPool()
) {
  const context = { options, bufferPool }
  return pipe(context, analyze, allocate, quantize)
}
