/**
 * Carta1 Audio Codec - Encoding Pipeline
 *
 * The frame pipeline reads as analysis, allocation, then quantization. Byte
 * packing remains the responsibility of serializeFrame().
 */

import { analyze } from '../analysis/stage.js'
import { allocateBits } from '../coding/bitallocation.js'
import {
  groupIntoBFUs,
  quantize as quantizeCoefficient,
} from '../coding/quantization.js'
import { BufferPool } from '../core/buffers.js'
import { WORD_LENGTH_BITS } from '../core/constants.js'
import { EncoderOptions } from '../core/options.js'
import { pipe, throwError } from '../utils.js'

/**
 * Allocate the frame budget across block floating units.
 *
 * @param {Object} context
 * @param {EncoderOptions} context.options
 * @returns {Function}
 */
export function allocate(context) {
  const options =
    context?.options ?? throwError('allocate: options is required')

  /**
   * @param {{coefficients: Float32Array, blockModes: Array<number>}} input
   * @returns {Object}
   */
  return (input) => {
    const { coefficients, blockModes } = input
    const { bfuData, bfuSizes, bfuCount } = groupIntoBFUs(
      coefficients,
      blockModes
    )
    const {
      bfuCount: selectedBfuCount,
      allocation,
      scaleFactorIndices,
    } = allocateBits(bfuData, bfuSizes, bfuCount, options.allocationBias)

    return {
      bfuData,
      bfuSizes,
      nBfu: selectedBfuCount,
      scaleFactorIndices: scaleFactorIndices.slice(0, selectedBfuCount),
      wordLengthIndices: allocation.slice(0, selectedBfuCount),
      blockModes,
    }
  }
}

/**
 * Materialize the retained allocation as quantized ATRAC1 symbols.
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
