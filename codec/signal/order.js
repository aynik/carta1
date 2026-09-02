/** ATRAC1 spectral ordering. */

/**
 * Reverse spectral order for ATRAC1 mid and high bands.
 *
 * @param {Float32Array} spectrum Spectrum in transform order.
 * @param {object} reversalBuffers Reusable outputs indexed by spectrum length.
 * @returns {Float32Array} Reversed spectrum.
 */
export function reverseSpectrum(spectrum, reversalBuffers) {
  const reversed = reversalBuffers[spectrum.length]
  for (let index = 0; index < spectrum.length; index++) {
    reversed[index] = spectrum[spectrum.length - 1 - index]
  }
  return reversed
}
