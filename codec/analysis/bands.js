/**
 * Carta1 QMF analysis application.
 */

import { qmfAnalysis } from '../transforms/qmf.js'
import { throwError } from '../utils.js'

/**
 * Split PCM into the three ATRAC1 frequency bands.
 *
 * @param {Object} context
 * @param {import('../core/buffers.js').BufferPool} context.bufferPool
 * @returns {Function}
 * @throws {Error} If the buffer pool is missing
 */
export function analyzeBands(context) {
  const bufferPool =
    context?.bufferPool ?? throwError('analyzeBands: bufferPool is required')
  const delays = bufferPool.qmfDelays

  /**
   * @param {Float32Array} pcmSamples
   * @returns {{bands: Array<Float32Array>}}
   */
  return (pcmSamples) => {
    const stage1 = qmfAnalysis(
      pcmSamples,
      delays.lowBand,
      bufferPool.qmfWorkBuffers
    )
    delays.lowBand = stage1.newDelay

    const stage2 = qmfAnalysis(
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
