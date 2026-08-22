/**
 * Carta1 spectral synthesis application.
 */

import {
  MDCT_BAND_CONFIGS,
  MDCT_SHORT_BLOCK_SIZE,
  MDCT_SIZE_LONG,
  MDCT_TAIL_WINDOW_SIZE,
  WINDOW_SHORT,
} from '../core/constants.js'
import { imdct64, imdct256, imdct512, overlapAdd } from '../transforms/mdct.js'
import {
  extractBandCoefficients,
  reverseSpectrum,
  throwError,
} from '../utils.js'

/**
 * Synthesize time-domain bands from the ATRAC1 spectrum.
 *
 * @param {Object} context
 * @param {import('../core/buffers.js').BufferPool} context.bufferPool
 * @returns {Function}
 * @throws {Error} If the buffer pool is missing
 */
export function synthesizeSpectrum(context) {
  const bufferPool =
    context?.bufferPool ??
    throwError('synthesizeSpectrum: bufferPool is required')
  const overlapBuffers = bufferPool.imdctOverlap
  const transformFunctions = [imdct256, imdct256, imdct512]

  /**
   * @param {Float32Array} coefficients
   * @param {number} bandIndex
   * @param {number} blockMode
   * @param {Float32Array} overlapBuffer
   * @param {Object} config
   * @returns {Float32Array}
   */
  function transformBand(
    coefficients,
    bandIndex,
    blockMode,
    overlapBuffer,
    config
  ) {
    if (blockMode === 0) {
      return inverseLongBlock(
        coefficients,
        bandIndex,
        overlapBuffer,
        config,
        transformFunctions[bandIndex]
      )
    }

    return inverseShortBlocks(coefficients, bandIndex, overlapBuffer, config)
  }

  /**
   * @param {Float32Array} coefficients
   * @param {number} bandIndex
   * @param {Float32Array} overlapBuffer
   * @param {Object} config
   * @param {Object} transformFunction
   * @returns {Float32Array}
   */
  function inverseLongBlock(
    coefficients,
    bandIndex,
    overlapBuffer,
    config,
    transformFunction
  ) {
    let blockSpectrum = coefficients
    if (bandIndex > 0) {
      blockSpectrum = reverseSpectrum(coefficients, bufferPool.reversalBuffers)
    }

    const inverse = transformFunction.transform(
      blockSpectrum,
      bufferPool.mdctBuffers
    )
    const inverseStart = inverse.length / 4
    const inverseBuffer = bufferPool.transformBuffers[MDCT_SIZE_LONG]
    inverseBuffer.fill(0)

    for (let i = 0; i < config.size; i++) {
      inverseBuffer[i] = inverse[inverseStart + i]
    }

    const previous = overlapBuffer.slice(
      config.size * 2 - MDCT_TAIL_WINDOW_SIZE,
      config.size * 2
    )
    const overlap = overlapAdd(
      previous.slice(0, MDCT_TAIL_WINDOW_SIZE),
      inverseBuffer.slice(0, MDCT_TAIL_WINDOW_SIZE),
      WINDOW_SHORT
    )
    overlapBuffer.set(overlap, 0)

    for (let i = 0; i < MDCT_TAIL_WINDOW_SIZE; i++) {
      previous[i] = inverseBuffer[MDCT_TAIL_WINDOW_SIZE + i]
    }

    const copyLength = bandIndex === 2 ? 240 : 112
    for (let i = 0; i < copyLength; i++) {
      overlapBuffer[32 + i] = inverseBuffer[MDCT_TAIL_WINDOW_SIZE + i]
    }

    for (let i = 0; i < MDCT_TAIL_WINDOW_SIZE; i++) {
      overlapBuffer[config.size * 2 - MDCT_TAIL_WINDOW_SIZE + i] =
        inverseBuffer[config.size - MDCT_TAIL_WINDOW_SIZE + i]
    }

    return overlapBuffer.slice(0, config.size)
  }

  /**
   * @param {Float32Array} coefficients
   * @param {number} bandIndex
   * @param {Float32Array} overlapBuffer
   * @param {Object} config
   * @returns {Float32Array}
   */
  function inverseShortBlocks(coefficients, bandIndex, overlapBuffer, config) {
    const numBlocks = 1 << (config.size === 256 ? 3 : 2)
    const inverseBuffer = bufferPool.transformBuffers[MDCT_SIZE_LONG]
    inverseBuffer.fill(0)

    const previous = overlapBuffer.slice(
      config.size * 2 - MDCT_TAIL_WINDOW_SIZE,
      config.size * 2
    )
    let start = 0
    let position = 0

    for (let block = 0; block < numBlocks; block++) {
      let blockSpectrum = coefficients.slice(
        position,
        position + MDCT_SHORT_BLOCK_SIZE
      )
      if (bandIndex > 0) {
        blockSpectrum = reverseSpectrum(
          blockSpectrum,
          bufferPool.reversalBuffers
        )
      }

      const inverse = imdct64.transform(blockSpectrum, bufferPool.mdctBuffers)
      const inverseStart = inverse.length / 4
      for (let i = 0; i < MDCT_SHORT_BLOCK_SIZE; i++) {
        inverseBuffer[start + i] = inverse[inverseStart + i]
      }

      const overlap = overlapAdd(
        previous.slice(0, MDCT_TAIL_WINDOW_SIZE),
        inverseBuffer.slice(start, start + MDCT_TAIL_WINDOW_SIZE),
        WINDOW_SHORT
      )
      overlapBuffer.set(overlap, start)

      for (let i = 0; i < MDCT_TAIL_WINDOW_SIZE; i++) {
        previous[i] = inverseBuffer[start + MDCT_TAIL_WINDOW_SIZE + i]
      }

      start += MDCT_SHORT_BLOCK_SIZE
      position += MDCT_SHORT_BLOCK_SIZE
    }

    for (let i = 0; i < MDCT_TAIL_WINDOW_SIZE; i++) {
      overlapBuffer[config.size * 2 - MDCT_TAIL_WINDOW_SIZE + i] =
        inverseBuffer[config.size - MDCT_TAIL_WINDOW_SIZE + i]
    }

    return overlapBuffer.slice(0, config.size)
  }

  /**
   * @param {{coefficients: Float32Array, blockModes: Array<number>}} input
   * @returns {Array<Float32Array>}
   */
  return (input) => {
    const { coefficients, blockModes } = input

    return MDCT_BAND_CONFIGS.map((config, bandIndex) => {
      const bandCoefficients = extractBandCoefficients(coefficients, bandIndex)
      return transformBand(
        bandCoefficients,
        bandIndex,
        blockModes[bandIndex],
        overlapBuffers[bandIndex],
        config
      )
    })
  }
}
