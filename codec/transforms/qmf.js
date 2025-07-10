/**
 * Carta1 Audio Codec - Quadrature Mirror Filter
 *
 * This module implements QMF analysis and synthesis for subband decomposition
 * in the ATRAC1 codec. The QMF splits the audio signal into multiple frequency
 * bands for independent processing and coding.
 */

import { QMF_TAPS, QMF_DELAY } from '../core/constants.js'
import { throwError } from '../utils.js'

// QMF prototype filter coefficients
const QMF_COEFFS = new Float32Array([
  -0.00001461907, -0.00009205479, -0.000056157569, 0.00030117269, 0.0002422519,
  -0.00085293897, -0.0005205574, 0.0020340169, 0.00078333891, -0.0042153862,
  -0.00075614988, 0.0078402944, -0.000061169922, -0.01344162, 0.0024626821,
  0.021736089, -0.007801671, -0.034090221, 0.01880949, 0.054326009,
  -0.043596379, -0.099384367, 0.13207909, 0.46424159,
])

// Build full window
const QMF_WINDOW = new Float32Array(QMF_TAPS)
for (let i = 0; i < 24; i++) {
  QMF_WINDOW[i] = QMF_COEFFS[i] * 2.0
  QMF_WINDOW[47 - i] = QMF_COEFFS[i] * 2.0
}

// Separate even/odd taps for optimization
const QMF_EVEN = new Float32Array(24)
const QMF_ODD = new Float32Array(24)
for (let i = 0; i < 24; i++) {
  QMF_EVEN[i] = QMF_WINDOW[i * 2]
  QMF_ODD[i] = QMF_WINDOW[i * 2 + 1]
}

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
    throwError('qmfAnalysis: workBuffer is required')
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
    throwError('qmfSynthesis: workBuffer is required')
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
