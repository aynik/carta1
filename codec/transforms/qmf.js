/**
 * Carta1 Audio Codec - Quadrature Mirror Filter
 *
 * This module implements QMF analysis and synthesis for subband decomposition
 * in the ATRAC1 codec. The QMF splits the audio signal into multiple frequency
 * bands for independent processing and coding.
 */

import { QMF_DELAY, QMF_EVEN, QMF_ODD } from '../core/constants.js'
import { throwError } from '../utils.js'

/**
 * Perform QMF analysis filtering to split input into low and high frequency bands
 * @param {Float32Array} input - Input audio samples
 * @param {Float32Array} delayLine - QMF delay line state
 * @param {Object} qmfWorkBuffers - Optional work buffers for processing
 * @returns {Object} Object containing lowBand, highBand, and newDelay
 */
export function qmfAnalysis(input, delayLine, qmfWorkBuffers = null) {
  const inputLength = input.length
  const outputLength = inputLength >> 1

  const workBuffer =
    qmfWorkBuffers?.delay?.[inputLength] ??
    throwError(`qmfAnalysis: qmfWorkBuffers.delay[${inputLength}] is required`)
  workBuffer.set(delayLine)
  workBuffer.set(input, delayLine.length)

  const lowBand = new Float32Array(outputLength)
  const highBand = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    let evenSum = 0
    let oddSum = 0
    const offset = i * 2

    // Unrolled convolution
    for (let j = 0; j < 24; j++) {
      evenSum += workBuffer[offset + 47 - j * 2] * QMF_EVEN[j]
      oddSum += workBuffer[offset + 46 - j * 2] * QMF_ODD[j]
    }

    lowBand[i] = evenSum + oddSum
    highBand[i] = evenSum - oddSum
  }

  // Update delay line
  const newDelay = workBuffer.slice(-QMF_DELAY)
  return { lowBand, highBand, newDelay }
}

/**
 * Perform QMF synthesis filtering to reconstruct audio from low and high frequency bands
 * @param {Float32Array} lowBand - Low frequency band samples
 * @param {Float32Array} highBand - High frequency band samples
 * @param {Float32Array} delayLine - QMF delay line state
 * @param {Object} qmfWorkBuffers - Optional work buffers for processing
 * @returns {Object} Object containing output and newDelay
 */
export function qmfSynthesis(
  lowBand,
  highBand,
  delayLine,
  qmfWorkBuffers = null
) {
  const subbandLength = lowBand.length
  const outputLength = subbandLength * 2

  const workBuffer =
    qmfWorkBuffers?.delay?.[outputLength] ??
    throwError(
      `qmfSynthesis: qmfWorkBuffers.delay[${outputLength}] is required`
    )
  workBuffer.set(delayLine)

  // Upsample and merge
  for (let i = 0; i < subbandLength; i++) {
    const low = lowBand[i]
    const high = highBand[i]
    const offset = QMF_DELAY + i * 2
    workBuffer[offset] = 0.5 * (low + high)
    workBuffer[offset + 1] = 0.5 * (low - high)
  }

  const output = new Float32Array(outputLength)

  // Convolution
  for (let i = 0; i < subbandLength; i++) {
    const offset = i * 2
    let sample0 = 0
    let sample1 = 0

    for (let j = 0; j < 24; j++) {
      const idx = offset + j * 2
      sample0 += workBuffer[idx] * QMF_EVEN[j]
      sample1 += workBuffer[idx + 1] * QMF_ODD[j]
    }

    output[i * 2] = sample1
    output[i * 2 + 1] = sample0
  }

  const newDelay = workBuffer.slice(-QMF_DELAY)
  return { output, newDelay }
}
