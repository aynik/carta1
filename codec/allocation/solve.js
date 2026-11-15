/**
 * Carta1 Sound-Unit bit allocation solver.
 *
 * Derives simultaneous masking thresholds and outer/middle-ear sensitivity
 * weights per BFU, waterfill-tunes word lengths to the Sound-Unit payload
 * budget, refines allocations with Pareto perceptual exchanges and greedy slack
 * fill, selects the active BFU ceiling per ATRAC1 legal counts, and tightens
 * scale factors where peak outer-bin rounding lowers reconstruction MSE.
 */

import {
  BFU_DISTORTION_CACHE_STRIDE,
  BITS_PER_BFU_METADATA,
  FRAME_BITS,
  FRAME_OVERHEAD_BITS,
} from '../core/constants.js'
import { BFU_AMOUNTS } from '../core/tables.js'
import { SoundUnitAllocationScratch } from '../state/encoder.js'
import { buildPerceptualMask, buildPerceptualWeights } from './distortion.js'
import {
  exchangePerceptualBits,
  fillSlackBits,
  refineScaleFactors,
  tuneToBudget,
} from './refine.js'

/**
 * @typedef {object} SoundUnitAllocationSolverScratch
 * @property {Float64Array} energies
 * @property {Float64Array} maxAmplitudes
 * @property {Int32Array} initialScaleFactorIndices
 * @property {Float64Array} maskThresholds
 * @property {Float64Array} perceptualWeights
 * @property {Float64Array} seedThresholds
 * @property {Float64Array} distortionCache
 * @property {Int32Array} candidateWordLengths
 * @property {Int32Array} selectedWordLengths
 * @property {Int32Array} refinedScaleFactorIndices
 */

/** @type {SoundUnitAllocationSolverScratch} */
const defaultScratch = new SoundUnitAllocationScratch()

/**
 * Solve word-length allocation for one legal BFU count ceiling.
 *
 * @param {i32} candidateBfuCount
 * @param {Array<Float32Array>} bfuData
 * @param {Array<number>} bfuSizes
 * @param {Int32Array} initialScaleFactorIndices
 * @param {Float64Array} maxAmplitudes
 * @param {Float64Array} energies
 * @param {Float64Array} perceptualWeights
 * @param {Float64Array} seedThresholds
 * @param {Float64Array} distortionCache
 * @param {Int32Array} candidateWordLengths
 * @returns {void}
 * @nativeUnchecked Native callers supply frame-bounded buffers and indices.
 */
function solveForBfuCount(
  candidateBfuCount,
  bfuData,
  bfuSizes,
  initialScaleFactorIndices,
  maxAmplitudes,
  energies,
  perceptualWeights,
  seedThresholds,
  distortionCache,
  candidateWordLengths
) {
  const bitBudget =
    FRAME_BITS - FRAME_OVERHEAD_BITS - candidateBfuCount * BITS_PER_BFU_METADATA
  /** @type {i32} */
  let usedBits = tuneToBudget(
    candidateBfuCount,
    bitBudget,
    bfuSizes,
    energies,
    seedThresholds,
    candidateWordLengths
  )
  usedBits = exchangePerceptualBits(
    candidateBfuCount,
    bitBudget,
    usedBits,
    bfuData,
    bfuSizes,
    initialScaleFactorIndices,
    maxAmplitudes,
    energies,
    perceptualWeights,
    distortionCache,
    candidateWordLengths
  )
  fillSlackBits(
    candidateBfuCount,
    bitBudget - usedBits,
    bfuData,
    bfuSizes,
    initialScaleFactorIndices,
    maxAmplitudes,
    energies,
    perceptualWeights,
    distortionCache,
    candidateWordLengths
  )
}

/**
 * Allocate bits across BFUs for one transformed ATRAC1 channel frame.
 *
 * @param {Array<Float32Array>} bfuData
 * @param {Array<number>} bfuSizes
 * @param {i32} maxBfuCount
 * @param {f64} allocationBias
 * @param {Array<number>} [blockModes]
 * @param {SoundUnitAllocationSolverScratch} [scratch]
 * @returns {{bfuCount:number, allocation:Int32Array, scaleFactorIndices:Int32Array}}
 */
export function solve(
  bfuData,
  bfuSizes,
  maxBfuCount,
  allocationBias,
  blockModes = null,
  scratch = null
) {
  /** @type {SoundUnitAllocationSolverScratch} */
  const scratchBuffer = scratch ?? defaultScratch
  const energies = scratchBuffer.energies
  const maxAmplitudes = scratchBuffer.maxAmplitudes
  const initialScaleFactorIndices = scratchBuffer.initialScaleFactorIndices
  const maskThresholds = scratchBuffer.maskThresholds
  const perceptualWeights = scratchBuffer.perceptualWeights
  const seedThresholds = scratchBuffer.seedThresholds
  const distortionCache = scratchBuffer.distortionCache
  const candidateWordLengths = scratchBuffer.candidateWordLengths
  const selectedWordLengths = scratchBuffer.selectedWordLengths
  const refinedScaleFactorIndices = scratchBuffer.refinedScaleFactorIndices

  /** @type {f64} */
  let totalEnergy = 0.0
  for (let unit = 0; unit < maxBfuCount; unit++) {
    const size = bfuSizes[unit] | 0
    if (size <= 0) {
      energies[unit] = 0.0
      maxAmplitudes[unit] = 0.0
      initialScaleFactorIndices[unit] = 0
      continue
    }

    /** @type {Float32Array} */
    const bfu = bfuData[unit]
    /** @type {f64} */
    let energy = 0.0
    /** @type {f64} */
    let maxAmplitude = 0.0
    for (let index = 0; index < size; index++) {
      const value = bfu[index]
      energy += value * value
      const absValue = value < 0.0 ? -value : value
      if (absValue > maxAmplitude) maxAmplitude = absValue
    }

    energies[unit] = energy
    maxAmplitudes[unit] = maxAmplitude
    totalEnergy += energy

    if (maxAmplitude === 0.0) {
      initialScaleFactorIndices[unit] = 0
    } else {
      const scaleIndex = Math.ceil(3.0 * (Math.log2(maxAmplitude) + 21.0)) | 0
      initialScaleFactorIndices[unit] =
        scaleIndex < 0 ? 0 : scaleIndex > 63 ? 63 : scaleIndex
    }
  }

  const cacheEntryCount = maxBfuCount * BFU_DISTORTION_CACHE_STRIDE
  for (let index = 0; index < cacheEntryCount; index++) {
    distortionCache[index] = -1.0
  }

  /** @type {i32} */
  let maxLegalBfuCount = maxBfuCount
  const firstLegalBfuCount = BFU_AMOUNTS[0]
  if (firstLegalBfuCount < maxLegalBfuCount)
    maxLegalBfuCount = firstLegalBfuCount
  for (let index = 1; index < BFU_AMOUNTS.length; index++) {
    const candidate = BFU_AMOUNTS[index]
    if (candidate <= maxBfuCount) maxLegalBfuCount = candidate
  }

  if (totalEnergy === 0.0 || maxLegalBfuCount <= 0) {
    return {
      bfuCount: maxLegalBfuCount,
      allocation: new Int32Array(maxLegalBfuCount),
      scaleFactorIndices: new Int32Array(maxBfuCount),
    }
  }

  let lowBandMode = 0
  let midBandMode = 0
  let highBandMode = 0
  if (blockModes) {
    lowBandMode = blockModes[0] | 0
    midBandMode = blockModes[1] | 0
    highBandMode = blockModes[2] | 0
  }

  buildPerceptualMask(
    energies,
    maxAmplitudes,
    bfuSizes,
    maxBfuCount,
    totalEnergy,
    lowBandMode,
    midBandMode,
    highBandMode,
    maskThresholds
  )
  buildPerceptualWeights(
    energies,
    maxAmplitudes,
    initialScaleFactorIndices,
    bfuSizes,
    maxBfuCount,
    allocationBias,
    lowBandMode,
    midBandMode,
    highBandMode,
    maskThresholds,
    perceptualWeights,
    seedThresholds
  )

  solveForBfuCount(
    maxLegalBfuCount,
    bfuData,
    bfuSizes,
    initialScaleFactorIndices,
    maxAmplitudes,
    energies,
    perceptualWeights,
    seedThresholds,
    distortionCache,
    candidateWordLengths
  )

  let lastActive = 0
  for (let unit = maxLegalBfuCount - 1; unit >= 0; unit--) {
    if (candidateWordLengths[unit] > 0) {
      lastActive = unit + 1
      break
    }
  }

  /** @type {i32} */
  let bestBfuCount = maxLegalBfuCount
  for (let index = 0; index < BFU_AMOUNTS.length; index++) {
    const candidate = BFU_AMOUNTS[index]
    if (candidate <= maxLegalBfuCount && candidate >= lastActive) {
      bestBfuCount = candidate
      break
    }
  }

  if (bestBfuCount < maxLegalBfuCount) {
    solveForBfuCount(
      bestBfuCount,
      bfuData,
      bfuSizes,
      initialScaleFactorIndices,
      maxAmplitudes,
      energies,
      perceptualWeights,
      seedThresholds,
      distortionCache,
      candidateWordLengths
    )
  }

  for (let unit = 0; unit < bestBfuCount; unit++) {
    selectedWordLengths[unit] = candidateWordLengths[unit]
  }

  refineScaleFactors(
    bestBfuCount,
    maxBfuCount,
    bfuData,
    bfuSizes,
    energies,
    initialScaleFactorIndices,
    selectedWordLengths,
    refinedScaleFactorIndices
  )

  return {
    bfuCount: bestBfuCount,
    allocation: selectedWordLengths.slice(0, bestBfuCount),
    scaleFactorIndices: refinedScaleFactorIndices.slice(0, maxBfuCount),
  }
}

/**
 * Find the optimal scale factor index for a set of coefficients.
 * Same semantics as the original.
 *
 * @param {Float32Array} coefficients
 * @param {i32} length
 * @returns {i32}
 */
export function findScaleFactor(coefficients, length) {
  let maxAmplitude = 0.0
  for (let index = 0; index < length; index++) {
    const amplitude = Math.abs(coefficients[index])
    if (amplitude > maxAmplitude) maxAmplitude = amplitude
  }
  if (maxAmplitude === 0) return 0
  const index = Math.ceil(3 * (Math.log2(maxAmplitude) + 21))
  return Math.max(0, Math.min(63, index))
}
