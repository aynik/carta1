/**
 * Carta1 allocation stage.
 */

import { throwError } from '../utils.js'
import { prepare } from './source.js'
import { solve } from './solve.js'

/**
 * @typedef {Object} AllocationFrame
 * @property {Array<Float32Array>} bfuData Spectral data grouped by BFU
 * @property {Array<number>} bfuSizes Coefficient count for each BFU
 * @property {number} nBfu Retained BFU count
 * @property {Int32Array} scaleFactorIndices Retained scale factors
 * @property {Int32Array} wordLengthIndices Retained word lengths
 * @property {Array<number>} blockModes Transform mode for each band
 */

/**
 * @callback AllocateFrame
 * @param {import('../analysis/stage.js').AnalysisFrame} input
 * @returns {AllocationFrame}
 */

/**
 * Allocate the frame budget across block floating units.
 *
 * @param {{options: import('../core/options.js').EncoderOptions}} context
 * @returns {AllocateFrame}
 */
export function allocate(context) {
  const options =
    context?.options ?? throwError('allocate: options is required')

  /**
   * @param {import('../analysis/stage.js').AnalysisFrame} input
   * @returns {AllocationFrame}
   */
  return (input) => {
    const { coefficients, blockModes } = input
    const { bfuData, bfuSizes, bfuCount } = prepare(coefficients, blockModes)
    const result = solve(bfuData, bfuSizes, bfuCount, options.allocationBias)
    const nBfu = result.bfuCount

    return {
      bfuData,
      bfuSizes,
      nBfu,
      scaleFactorIndices: result.scaleFactorIndices.slice(0, nBfu),
      wordLengthIndices: result.allocation.slice(0, nBfu),
      blockModes,
    }
  }
}
