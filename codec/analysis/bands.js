/**
 * Carta1 QMF analysis application.
 */

import { analyzeQmfPair } from '../signal/bands.js'
import { throwError } from '../utils.js'

/**
 * Split PCM into the three ATRAC1 frequency bands.
 *
 * @param {object} context
 * @returns {Function}
 * @throws {Error} If the buffer pool is missing
 */
export function analyzeBands(context) {
  const bufferPool =
    context?.bufferPool ?? throwError('analyzeBands: bufferPool is required')
  const delays = bufferPool.qmfDelays

  /**
   * @param {Float32Array} pcmSamples
   * @returns {object}
   */
  return (pcmSamples) => {
    const stage1 = analyzeQmfPair(
      pcmSamples,
      delays.lowBand,
      bufferPool.qmfWorkBuffers
    )
    delays.lowBand = stage1.newDelay

    const stage2 = analyzeQmfPair(
      stage1.lowBand,
      delays.midBand,
      bufferPool.qmfWorkBuffers
    )
    delays.midBand = stage2.newDelay

    const delayedHigh =
      bufferPool.qmfWorkBuffers.highBandDelay[stage1.highBand.length]
    delayedHigh.set(delays.highBand)
    delayedHigh.set(stage1.highBand, delays.highBand.length)

    const highBand = delayedHigh.slice(0, stage1.highBand.length)
    delays.highBand = delayedHigh.slice(stage1.highBand.length)

    return { bands: [stage2.lowBand, stage2.highBand, highBand] }
  }
}
