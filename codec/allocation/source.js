/**
 * Carta1 allocation-source preparation.
 */

import {
  BFU_BAND_BOUNDARIES,
  BFU_START_LONG,
  BFU_START_SHORT,
  SPECS_PER_BFU,
} from '../core/tables.js'

/**
 * @typedef {object} SoundUnitAllocationSourceScratch
 * @property {Array<Float32Array>} bfuData
 * @property {Array<number>} bfuSizes
 */

/**
 * Group spectral coefficients into block floating units.
 *
 * @param {Float32Array} coefficients
 * @param {Array<number>} blockModes
 * @param {SoundUnitAllocationSourceScratch} [scratch]
 * @returns {object} Grouped bit-frequency units.
 */
export function groupIntoBFUs(coefficients, blockModes, scratch = null) {
  /** @type {Array<Float32Array>} */
  const bfuData = scratch ? scratch.bfuData : []
  /** @type {Array<number>} */
  const bfuSizes = scratch ? scratch.bfuSizes : []
  let coefficientOffset = 0
  let bfuIndex = 0

  for (let band = 0; band < 3; band++) {
    const bandStart = coefficientOffset
    const bandSize = band === 2 ? 256 : 128
    const bandEnd = band < 2 ? BFU_BAND_BOUNDARIES[band] : SPECS_PER_BFU.length
    /** @type {Int32Array} */
    const startPositions =
      blockModes[band] === 0 ? BFU_START_LONG : BFU_START_SHORT

    while (bfuIndex < bandEnd) {
      const size = SPECS_PER_BFU[bfuIndex]
      const startOffset = startPositions[bfuIndex] - bandStart
      const endOffset = startOffset + size
      /** @type {Float32Array} */
      const bfu = scratch ? bfuData[bfuIndex] : new Float32Array(size)

      if (startOffset >= 0 && endOffset <= bandSize) {
        const sourceBase = bandStart + startOffset
        for (let index = 0; index < size; index++) {
          bfu[index] = coefficients[sourceBase + index]
        }
      } else if (startOffset < bandSize && endOffset > 0) {
        bfu.fill(0)
        const sourceStart = Math.max(0, startOffset)
        const sourceEnd = Math.min(bandSize, endOffset)
        const destinationOffset = Math.max(0, -startOffset)
        const count = sourceEnd - sourceStart
        for (let index = 0; index < count; index++) {
          bfu[destinationOffset + index] =
            coefficients[bandStart + sourceStart + index]
        }
      } else if (scratch) {
        bfu.fill(0)
      }

      if (!scratch) {
        bfuData.push(bfu)
        bfuSizes.push(size)
      }
      bfuIndex++
    }

    coefficientOffset += bandSize
  }

  return { bfuData, bfuSizes, bfuCount: bfuIndex }
}

/**
 * Prepare the spectrum as an allocation source.
 *
 * @param {Float32Array} coefficients
 * @param {Array<number>} blockModes
 * @param {SoundUnitAllocationSourceScratch} [scratch]
 * @returns {object} Allocation source.
 */
export function prepare(coefficients, blockModes, scratch = null) {
  return groupIntoBFUs(coefficients, blockModes, scratch)
}
