/**
 * Carta1 allocation stage.
 */

import { throwError } from '../utils.js'
import { prepare } from './source.js'
import { solve } from './solve.js'

/**
 * Allocate the frame budget across block floating units.
 *
 * @param {object} context
 * @returns {Function}
 */
export function allocate(context) {
  const options =
    context?.options ?? throwError('allocate: options is required')
  const scratch = context?.bufferPool?.allocationScratch ?? null

  /**
   * @param {object} input
   * @returns {object}
   */
  return (input) => {
    const { coefficients, blockModes } = input
    const { bfuData, bfuSizes, bfuCount } = prepare(
      coefficients,
      blockModes,
      scratch
    )
    const result = solve(
      bfuData,
      bfuSizes,
      bfuCount,
      options.allocationBias,
      blockModes,
      scratch
    )
    const nBfu = result.bfuCount

    return {
      bfuData,
      bfuSizes,
      nBfu,
      scaleFactorIndices: result.scaleFactorIndices.slice(0, nBfu),
      wordLengthIndices: result.allocation,
      blockModes,
    }
  }
}
