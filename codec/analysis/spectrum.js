/**
 * Carta1 spectral analysis application.
 */

import {
  MDCT_BAND_CONFIGS,
  MDCT_OVERLAP_SIZE,
  MDCT_SHORT_BLOCK_SIZE,
  MDCT_SIZE_LONG,
  MDCT_SIZE_MID,
  MDCT_SIZE_SHORT,
  WINDOW_SHORT,
} from '../core/constants.js'
import { calculateBandOffset } from '../core/geometry.js'
import {
  mdct64,
  mdct256,
  mdct512,
  reverseSpectrum,
} from '../signal/spectrum.js'
import { throwError } from '../utils.js'

/**
 * Build the ATRAC1 spectrum from analyzed bands.
 *
 * @param {Object} context
 * @param {import('../core/buffers.js').BufferPool} context.bufferPool
 * @returns {Function}
 * @throws {Error} If the buffer pool is missing
 */
export function transformSpectrum(context) {
  const bufferPool =
    context?.bufferPool ??
    throwError('transformSpectrum: bufferPool is required')
  const overlapBuffers = bufferPool.mdctOverlap
  const transformFunctions = [mdct256, mdct256, mdct512]

  /**
   * @param {Float32Array} samples
   * @param {number} bandIndex
   * @param {number} blockMode
   * @param {Float32Array} overlapBuffer
   * @returns {Float32Array}
   */
  function transformBand(samples, bandIndex, blockMode, overlapBuffer) {
    const config = MDCT_BAND_CONFIGS[bandIndex]

    if (blockMode === 0) {
      return transformLongBlock(
        samples,
        bandIndex,
        config,
        transformFunctions[bandIndex],
        overlapBuffer
      )
    }

    return transformShortBlocks(samples, bandIndex, config, overlapBuffer)
  }

  /**
   * @param {Float32Array} samples
   * @param {number} bandIndex
   * @param {Object} config
   * @param {Object} transformFunction
   * @param {Float32Array} overlapBuffer
   * @returns {Float32Array}
   */
  function transformLongBlock(
    samples,
    bandIndex,
    config,
    transformFunction,
    overlapBuffer
  ) {
    const mdctSize = bandIndex === 2 ? MDCT_SIZE_LONG : MDCT_SIZE_MID
    const mdctInput = bufferPool.transformBuffers[mdctSize]
    mdctInput.fill(0)
    mdctInput.set(overlapBuffer, config.windowStart)

    applyTailWindowing(samples, overlapBuffer, config.size)
    mdctInput.set(samples, config.windowStart + MDCT_OVERLAP_SIZE)

    let spectrum = transformFunction.transform(
      mdctInput,
      bufferPool.mdctBuffers
    )
    if (bandIndex > 0) {
      spectrum = reverseSpectrum(spectrum, bufferPool.reversalBuffers)
    }
    return spectrum
  }

  /**
   * @param {Float32Array} samples
   * @param {number} bandIndex
   * @param {Object} config
   * @param {Float32Array} overlapBuffer
   * @returns {Float32Array}
   */
  function transformShortBlocks(samples, bandIndex, config, overlapBuffer) {
    const numBlocks = 1 << (config.size === 256 ? 3 : 2)
    const output = new Float32Array(config.size)

    for (let block = 0; block < numBlocks; block++) {
      const blockStart = block * MDCT_SHORT_BLOCK_SIZE
      const blockSamples = samples.subarray(
        blockStart,
        blockStart + MDCT_SHORT_BLOCK_SIZE
      )
      const mdctInput = bufferPool.transformBuffers[MDCT_SIZE_SHORT]
      mdctInput.fill(0)
      mdctInput.set(overlapBuffer, 0)

      applyTailWindowing(blockSamples, overlapBuffer, MDCT_SHORT_BLOCK_SIZE)
      mdctInput.set(blockSamples, MDCT_OVERLAP_SIZE)

      let spectrum = mdct64.transform(mdctInput, bufferPool.mdctBuffers)
      if (bandIndex > 0) {
        spectrum = reverseSpectrum(spectrum, bufferPool.reversalBuffers)
      }
      output.set(spectrum, blockStart)
    }

    return output
  }

  /**
   * @param {Float32Array} samples
   * @param {Float32Array} overlapBuffer
   * @param {number} blockSize
   */
  function applyTailWindowing(samples, overlapBuffer, blockSize) {
    const tailStart = blockSize - MDCT_OVERLAP_SIZE
    for (let i = 0; i < MDCT_OVERLAP_SIZE; i++) {
      const tailValue = samples[tailStart + i]
      overlapBuffer[i] = WINDOW_SHORT[i] * tailValue
      samples[tailStart + i] = tailValue * WINDOW_SHORT[31 - i]
    }
  }

  /**
   * @param {{bands: Array<Float32Array>, blockModes: Array<number>}} input
   * @returns {{bands: Array<Float32Array>, coefficients: Float32Array, blockModes: Array<number>}}
   */
  return (input) => {
    const { bands, blockModes } = input
    const coefficients = new Float32Array(512)

    bands.forEach((bandSamples, bandIndex) => {
      const transformed = transformBand(
        bandSamples,
        bandIndex,
        blockModes[bandIndex],
        overlapBuffers[bandIndex]
      )
      coefficients.set(transformed, calculateBandOffset(bandIndex))
    })

    return { bands, coefficients, blockModes }
  }
}
