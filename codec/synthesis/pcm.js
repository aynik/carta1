/**
 * Carta1 PCM synthesis application.
 */

import { synthesizeQmfPair } from '../signal/bands.js'
import { throwError } from '../utils.js'

/**
 * Synthesize full-spectrum PCM from frequency bands.
 *
 * @param {object} context
 * @returns {Function}
 * @throws {Error} If the buffer pool is missing
 */
export function synthesizePcm(context) {
  const bufferPool =
    context?.bufferPool ?? throwError('synthesizePcm: bufferPool is required')
  const delays = bufferPool.qmfDelays

  /**
   * @param {Array<Float32Array>} bands
   * @returns {Float32Array}
   */
  return (bands) => {
    const delayedHigh = bufferPool.qmfWorkBuffers.highBandDelay[bands[2].length]
    delayedHigh.set(delays.highBand)
    delayedHigh.set(bands[2], delays.highBand.length)

    const highBand = delayedHigh.slice(0, bands[0].length * 2)
    delays.highBand = delayedHigh.slice(bands[0].length * 2)

    const stage2 = synthesizeQmfPair(
      bands[0],
      bands[1],
      delays.midBand,
      bufferPool.qmfWorkBuffers
    )
    delays.midBand = stage2.newDelay

    const stage1 = synthesizeQmfPair(
      stage2.output,
      highBand,
      delays.lowBand,
      bufferPool.qmfWorkBuffers
    )
    delays.lowBand = stage1.newDelay

    return stage1.output
  }
}
