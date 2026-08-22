/**
 * Carta1 analysis stage.
 */

import { pipe } from '../utils.js'
import { analyzeBands } from './bands.js'
import { selectBlocks } from './blocks.js'
import { transformSpectrum } from './spectrum.js'

/**
 * Analyze a PCM frame in the ATRAC1 signal domain.
 *
 * @param {Object} context
 * @returns {Function}
 */
export function analyze(context) {
  const analyzeFrame = pipe(
    context,
    analyzeBands,
    selectBlocks,
    transformSpectrum
  )

  /**
   * @param {Float32Array} pcmSamples
   * @returns {{coefficients: Float32Array, blockModes: Array<number>}}
   */
  return (pcmSamples) => {
    const { coefficients, blockModes } = analyzeFrame(pcmSamples)
    return { coefficients, blockModes }
  }
}
