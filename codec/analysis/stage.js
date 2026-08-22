/**
 * Carta1 analysis stage.
 */

import { pipe } from '../utils.js'
import { analyzeBands } from './bands.js'
import { selectBlocks } from './blocks.js'
import { transformSpectrum } from './spectrum.js'

/**
 * @typedef {Object} AnalysisFrame
 * @property {Float32Array} coefficients ATRAC1 spectral coefficients
 * @property {Array<number>} blockModes Transform mode for each band
 */

/**
 * @callback AnalyzeFrame
 * @param {Float32Array} pcmSamples
 * @returns {AnalysisFrame}
 */

/**
 * Analyze a PCM frame in the ATRAC1 signal domain.
 *
 * @param {{bufferPool: import('../state.js').BufferPool, options: import('../core/options.js').EncoderOptions}} context
 * @returns {AnalyzeFrame}
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
   * @returns {AnalysisFrame}
   */
  return (pcmSamples) => {
    const { coefficients, blockModes } = analyzeFrame(pcmSamples)
    return { coefficients, blockModes }
  }
}
