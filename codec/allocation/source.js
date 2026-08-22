/**
 * Carta1 allocation-source preparation.
 */

import {
  BFU_BAND_BOUNDARIES,
  BFU_START_LONG,
  BFU_START_SHORT,
  SPECS_PER_BFU,
} from '../core/constants.js'

/**
 * Group spectral coefficients into block floating units.
 *
 * @param {Float32Array} coefficients
 * @param {Array<number>} blockModes
 * @returns {{bfuData: Array<Float32Array>, bfuSizes: Array<number>, bfuCount: number}}
 */
export function groupIntoBFUs(coefficients, blockModes) {
  const bfuData = []
  const bfuSizes = []
  let coeffIndex = 0
  let bfuIndex = 0

  for (let band = 0; band < 3; band++) {
    const bandStart = coeffIndex
    const bandSize = band === 2 ? 256 : 128
    const bandEnd = band < 2 ? BFU_BAND_BOUNDARIES[band] : SPECS_PER_BFU.length
    const startPositions =
      blockModes[band] === 0 ? BFU_START_LONG : BFU_START_SHORT

    while (bfuIndex < bandEnd) {
      const size = SPECS_PER_BFU[bfuIndex]
      const startPos = startPositions[bfuIndex] - bandStart
      const endPos = startPos + size
      const bfu = new Float32Array(size)

      if (startPos >= 0 && endPos <= bandSize) {
        bfu.set(coefficients.subarray(bandStart + startPos, bandStart + endPos))
      } else if (startPos < bandSize && endPos > 0) {
        const srcStart = Math.max(0, startPos)
        const srcEnd = Math.min(bandSize, endPos)
        bfu.set(
          coefficients.subarray(bandStart + srcStart, bandStart + srcEnd),
          Math.max(0, -startPos)
        )
      }

      bfuData.push(bfu)
      bfuSizes.push(size)
      bfuIndex++
    }

    coeffIndex += bandSize
  }

  return { bfuData, bfuSizes, bfuCount: bfuIndex }
}

/**
 * Prepare the spectrum as an allocation source.
 *
 * @param {Float32Array} coefficients
 * @param {Array<number>} blockModes
 * @returns {{bfuData: Array<Float32Array>, bfuSizes: Array<number>, bfuCount: number}}
 */
export function prepare(coefficients, blockModes) {
  return groupIntoBFUs(coefficients, blockModes)
}
