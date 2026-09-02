/**
 * Carta1 QMF analysis application.
 */

import { QMF_ANALYSIS_DELAY_SAMPLES } from '../core/constants.js'
import { analyzeQmf } from '../signal/qmf.js'
import { throwError } from '../utils.js'

/**
 * Split one sample row through a two-band configurable QMF stage.
 *
 * @param {Float32Array} input
 * @param {Float32Array} delay
 * @param {object} scratch
 * @returns {Float32Array[]}
 */
function analyzePair(input, delay, scratch) {
  const window =
    scratch.analysisWindows[input.length] ??
    throwError(`QMF analysis window for ${input.length} samples is required`)
  window.set(delay)
  window.set(input, delay.length)

  const sampleCount = input.length / 2
  const bands = [new Float32Array(sampleCount), new Float32Array(sampleCount)]
  analyzeQmf(window, bands, scratch)
  delay.set(
    window.subarray(input.length, input.length + QMF_ANALYSIS_DELAY_SAMPLES)
  )
  return bands
}

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
  const delays = bufferPool.qmfAnalysisDelays
  const scratch = bufferPool.qmfScratch

  /**
   * @param {Float32Array} pcmSamples
   * @returns {object}
   */
  return (pcmSamples) => {
    const stage1 = analyzePair(pcmSamples, delays.lowBand, scratch)
    const stage2 = analyzePair(stage1[0], delays.midBand, scratch)

    const delayedHigh = scratch.highBandWindows[stage1[1].length]
    delayedHigh.set(bufferPool.qmfHighBandDelay)
    delayedHigh.set(stage1[1], bufferPool.qmfHighBandDelay.length)

    const highBand = delayedHigh.slice(0, stage1[1].length)
    bufferPool.qmfHighBandDelay.set(
      delayedHigh.subarray(
        stage1[1].length,
        stage1[1].length + bufferPool.qmfHighBandDelay.length
      )
    )

    return { bands: [stage2[0], stage2[1], highBand] }
  }
}
