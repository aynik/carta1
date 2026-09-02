/**
 * Carta1 PCM synthesis application.
 */

import { synthesizeQmf } from '../signal/qmf.js'
import { throwError } from '../utils.js'

/**
 * Join two subband rows through a configurable QMF synthesis stage.
 *
 * @param {Float32Array[]} bands
 * @param {object} state
 * @param {object} scratch
 * @returns {Float32Array}
 */
function synthesizePair(bands, state, scratch) {
  const output = new Float32Array(bands[0].length * 2)
  state.delayRow = synthesizeQmf(
    bands,
    state.delay,
    state.delayRow,
    output,
    scratch
  )
  return output
}

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
  const states = bufferPool.qmfSynthesisStates
  const scratch = bufferPool.qmfScratch

  /**
   * @param {Array<Float32Array>} bands
   * @returns {Float32Array}
   */
  return (bands) => {
    const delayedHigh = scratch.highBandWindows[bands[2].length]
    delayedHigh.set(bufferPool.qmfHighBandDelay)
    delayedHigh.set(bands[2], bufferPool.qmfHighBandDelay.length)

    const highBand = delayedHigh.slice(0, bands[0].length * 2)
    bufferPool.qmfHighBandDelay.set(
      delayedHigh.subarray(
        bands[0].length * 2,
        bands[0].length * 2 + bufferPool.qmfHighBandDelay.length
      )
    )

    const stage2 = synthesizePair([bands[0], bands[1]], states.midBand, scratch)

    const stage1 = synthesizePair([stage2, highBand], states.lowBand, scratch)

    return stage1
  }
}
