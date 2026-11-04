/** ATRAC1 two-band polyphase quadrature-mirror analysis and synthesis. */

import {
  QMF_ANALYSIS_TERMS,
  QMF_ANALYSIS_WINDOW_SAMPLES,
  QMF_BANDS,
  QMF_SYNTHESIS_DELAY_ROWS,
  QMF_SYNTHESIS_TERMS,
} from '../core/constants.js'
import { QMF_EVEN, QMF_ODD } from '../core/tables.js'

/**
 * Transform a window of samples into two chronological subband rows.
 * The input includes the preceding 46 samples of history.
 *
 * @param {Float32Array} input
 * @param {Float32Array[]} outputBands
 * @param {object} scratch Reusable QMF storage.
 * @returns {Float32Array[]}
 * @nativeUnchecked Native callers supply frame-bounded buffers and indices.
 */
export function analyzeQmf(input, outputBands, scratch) {
  if (
    !(input instanceof Float32Array) ||
    outputBands?.length !== QMF_BANDS ||
    outputBands.some(
      (band) =>
        !(band instanceof Float32Array) || band.length !== outputBands[0].length
    ) ||
    !scratch ||
    scratch.polyphase?.length !== QMF_BANDS ||
    scratch.extended?.length !== QMF_BANDS ||
    scratch.bands?.length !== QMF_BANDS
  ) {
    throw new RangeError('QMF analysis geometry is invalid')
  }

  const sampleCount = outputBands[0].length
  const requiredSamples =
    Math.max(0, sampleCount - 1) * QMF_BANDS + QMF_ANALYSIS_WINDOW_SAMPLES
  if (input.length < requiredSamples) {
    throw new RangeError('QMF analysis window is incomplete')
  }

  for (let sample = 0; sample < sampleCount; sample++) {
    const offset = sample * 2
    let even = 0
    let odd = 0
    for (let term = 0; term < QMF_ANALYSIS_TERMS; term++) {
      even += input[offset + 47 - term * 2] * QMF_EVEN[term]
      odd += input[offset + 46 - term * 2] * QMF_ODD[term]
    }
    outputBands[0][sample] = even + odd
    outputBands[1][sample] = even - odd
  }
  return outputBands
}

/**
 * Reconstruct interleaved PCM using a circular polyphase delay line.
 *
 * @param {Float32Array[]} inputBands Chronological subband rows.
 * @param {Float32Array} delay Caller-owned component delay ring.
 * @param {i32} delayRow Current delay-ring row.
 * @param {Float32Array} output Caller-owned interleaved PCM output.
 * @param {object} scratch Reusable QMF storage.
 * @returns {number} Next delay-ring row.
 * @nativeUnchecked Native callers supply frame-bounded buffers and indices.
 */
export function synthesizeQmf(inputBands, delay, delayRow, output, scratch) {
  if (
    inputBands?.length !== QMF_BANDS ||
    inputBands.some(
      (band) =>
        !(band instanceof Float32Array) || band.length !== inputBands[0].length
    ) ||
    !(delay instanceof Float32Array) ||
    delay.length !== QMF_SYNTHESIS_DELAY_ROWS * QMF_BANDS ||
    !Number.isInteger(delayRow) ||
    delayRow < 0 ||
    delayRow >= QMF_SYNTHESIS_DELAY_ROWS ||
    !(output instanceof Float32Array) ||
    output.length < inputBands[0].length * QMF_BANDS ||
    !scratch ||
    scratch.polyphase?.length !== QMF_BANDS ||
    scratch.bands?.length !== QMF_BANDS
  ) {
    throw new RangeError('QMF synthesis geometry is invalid')
  }

  for (let sample = 0; sample < inputBands[0].length; sample++) {
    const low = inputBands[0][sample]
    const high = inputBands[1][sample]
    delay[delayRow * 2] = 0.5 * low + 0.5 * high
    delay[delayRow * 2 + 1] = 0.5 * low - 0.5 * high

    let even = 0
    let odd = 0
    for (let term = 0; term < QMF_SYNTHESIS_TERMS; term++) {
      const row =
        (delayRow + QMF_SYNTHESIS_DELAY_ROWS - 1 - term) %
        QMF_SYNTHESIS_DELAY_ROWS
      even += delay[row * 2 + 1] * QMF_ODD[term]
      odd += delay[row * 2] * QMF_EVEN[term]
    }
    output[sample * 2] = even
    output[sample * 2 + 1] = odd
    delayRow = delayRow === 0 ? QMF_SYNTHESIS_DELAY_ROWS - 1 : delayRow - 1
  }
  return delayRow
}
