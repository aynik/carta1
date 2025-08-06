/**
 * Carta1 Audio Codec - Utilities
 *
 * This module provides common utility functions for the ATRAC1 codec including
 * pipeline composition, error handling, and audio stream processing utilities
 * for delay compensation and frame padding.
 */

import { CODEC_DELAY, SAMPLES_PER_FRAME } from './core/constants.js'

/**
 * Throws an error with the given message
 * @param {string} msg - Error message
 * @throws {Error} Always throws an error with the provided message
 */
export function throwError(msg) {
  throw new Error(msg)
}

/**
 * Creates a pipeline by composing multiple processing stages
 * @param {Object} context - Shared context passed to all stages
 * @param {...Function} stages - Stage functions to compose
 * @returns {Function} Composed pipeline function
 */
export function pipe(context, ...stages) {
  const functions = stages.map((stage) => stage(context))

  return (input) => {
    return functions.reduce((value, fn) => fn(value), input)
  }
}

/**
 * Pads audio frames and adds flush samples for proper codec delay handling
 * @param {AsyncIterable<Float32Array>} iter - Input frame stream
 * @param {number} [samplesToFlush=CODEC_DELAY] - Number of samples to flush
 * @yields {Float32Array} Padded frames with flush samples
 */
export async function* withFlushSamples(iter, samplesToFlush = CODEC_DELAY) {
  let lastFrameLength = SAMPLES_PER_FRAME
  for await (const frame of iter) {
    lastFrameLength = frame.length
    if (lastFrameLength === SAMPLES_PER_FRAME) {
      yield frame
    } else {
      // We need to pad
      const paddedFrame = new Float32Array(SAMPLES_PER_FRAME)
      paddedFrame.set(frame)
      yield paddedFrame
    }
  }
  if (SAMPLES_PER_FRAME - lastFrameLength < samplesToFlush) {
    yield new Float32Array(SAMPLES_PER_FRAME)
  }
}

/**
 * Applies delay compensation to PCM frame stream by dropping initial samples
 * @param {AsyncIterable<Float32Array>} pcmFrameStream - Input PCM frame stream
 * @param {number} [samplesToDrop=CODEC_DELAY] - Number of samples to drop for delay compensation
 * @yields {Float32Array} Delay-compensated PCM frames
 */
export async function* withDelayCompensation(
  pcmFrameStream,
  samplesToDrop = CODEC_DELAY
) {
  let buffer = new Float32Array(0)
  let droppedInitialSamples = false

  for await (const frame of pcmFrameStream) {
    // Drop samples from the very first frame only
    if (!droppedInitialSamples) {
      droppedInitialSamples = true
      if (samplesToDrop >= frame.length) {
        // Entire first frame is dropped
        samplesToDrop -= frame.length
        continue
      }
      // Keep only the portion after dropped samples
      buffer = frame.slice(samplesToDrop)
      samplesToDrop = 0
      continue
    }

    // Concatenate buffer with new frame
    const combined = new Float32Array(buffer.length + frame.length)
    combined.set(buffer)
    combined.set(frame, buffer.length)

    // Emit all complete frames
    let offset = 0
    while (offset + SAMPLES_PER_FRAME <= combined.length) {
      yield combined.slice(offset, offset + SAMPLES_PER_FRAME)
      offset += SAMPLES_PER_FRAME
    }

    // Buffer the remainder for next iteration
    buffer = combined.slice(offset)
  }

  // Emit final partial frame
  if (buffer.length > 0) {
    yield buffer
  }
}

/**
 * Adapts a mono transform function to work with stereo audio streams
 * @param {Function} monoTransform - Transform function for mono audio
 * @param {...*} args - Additional arguments to pass to the transform
 * @returns {Function} Stereo-adapted transform function
 */
export function withStereo(monoTransform, ...args) {
  return async function* (stereoIter) {
    // Buffer to store frames temporarily
    const leftFrames = []
    const rightFrames = []

    // Collect all frames first (necessary for proper synchronization)
    for await (const [left, right] of stereoIter) {
      leftFrames.push(left)
      rightFrames.push(right)
    }

    // Create mono iterators
    const leftIter = (async function* () {
      for (const frame of leftFrames) yield frame
    })()

    const rightIter = (async function* () {
      for (const frame of rightFrames) yield frame
    })()

    // Apply transform to each channel
    const leftTransformed = monoTransform(leftIter, ...args)
    const rightTransformed = monoTransform(rightIter, ...args)

    // Zip back together
    for await (const left of leftTransformed) {
      const { value: right } = await rightTransformed.next()
      if (right !== undefined) {
        yield [left, right]
      }
    }
  }
}

/**
 * Reverses the spectral order of coefficients for mid/high band processing
 *
 * Used in both MDCT and IMDCT stages to handle spectral reversal required
 * by the ATRAC1 format for mid and high frequency bands.
 *
 * @param {Float32Array} spectrum - Input spectrum coefficients
 * @param {Object} reversalBuffers - Pre-allocated buffers for different spectrum sizes
 * @returns {Float32Array} Spectrum with reversed coefficient order
 */
export function reverseSpectrum(spectrum, reversalBuffers) {
  const reversed = reversalBuffers[spectrum.length]
  for (let i = 0; i < spectrum.length; i++) {
    reversed[i] = spectrum[spectrum.length - 1 - i]
  }
  return reversed
}

/**
 * Calculates the starting offset for a frequency band in the coefficient array
 *
 * @param {number} bandIndex - Band index (0=low, 1=mid, 2=high)
 * @returns {number} Starting offset in the 512-sample coefficient array
 */
export function calculateBandOffset(bandIndex) {
  return bandIndex === 0 ? 0 : bandIndex === 1 ? 128 : 256
}

/**
 * Extracts coefficients for a specific frequency band from the full coefficient array
 *
 * @param {Float32Array} coefficients - Full 512-sample coefficient array
 * @param {number} bandIndex - Band index (0=low, 1=mid, 2=high)
 * @returns {Float32Array} Subarray containing coefficients for the specified band
 */
export function extractBandCoefficients(coefficients, bandIndex) {
  const offsets = [0, 128, 256, 512]
  return coefficients.subarray(offsets[bandIndex], offsets[bandIndex + 1])
}

// Stereo-adapted utility functions
export const withStereoFlushSamples = withStereo(withFlushSamples)
export const withStereoDelayCompensation = withStereo(withDelayCompensation)
