/**
 * Stable ATRAC1 spectral geometry.
 */

/**
 * Calculate a band's offset in the 512-coefficient spectrum.
 *
 * @param {number} bandIndex
 * @returns {number}
 */
export function calculateBandOffset(bandIndex) {
  return bandIndex === 0 ? 0 : bandIndex === 1 ? 128 : 256
}

/**
 * Extract one band from the full coefficient spectrum.
 *
 * @param {Float32Array} coefficients
 * @param {number} bandIndex
 * @returns {Float32Array}
 */
export function extractBandCoefficients(coefficients, bandIndex) {
  const offsets = [0, 128, 256, 512]
  return coefficients.subarray(offsets[bandIndex], offsets[bandIndex + 1])
}
