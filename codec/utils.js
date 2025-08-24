/**
 * Carta1 Audio Codec - Utilities
 *
 * This module provides common utility functions for the ATRAC1 codec including
 * pipeline composition, error handling, and audio stream processing utilities
 * for delay compensation and frame padding.
 */

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
