/**
 * Carta1 Audio Codec - Bit Allocation Module
 *
 * This module implements the bit allocation system for the Carta1 audio codec,
 * responsible for distributing available bits across frequency bands to minimize
 * perceptual distortion while maintaining the target bitrate.
 *
 * The module uses Rate-Distortion Optimization (RDO) by searching over a
 * predefined set of valid Band Frequency Unit (BFU) counts. For each count,
 * it performs a greedy bit distribution to find the best allocation. This
 * approach optimally trades off the cost of encoding more frequency bands
 * (metadata overhead) against the benefit of reducing truncation distortion.
 *
 * Key components:
 * - RDO search over valid BFU counts to select the optimal number of bands.
 * - Greedy bit allocation for a fixed BFU count using a max-heap.
 * - Exponential distortion modeling based on scale factors.
 * - Support for variable word lengths per BFU.
 *
 * The algorithm ensures that the codec dynamically adapts the encoded bandwidth
 * to best match the signal characteristics for the given bitrate.
 */

import {
  NUM_BFUS,
  FRAME_BITS,
  FRAME_OVERHEAD_BITS,
  BITS_PER_BFU_METADATA,
  MAX_WORD_LENGTH_INDEX,
} from '../core/constants.js'
import {
  WORD_LENGTH_BITS,
  INV_POWER_OF_TWO,
  SCALE_FACTORS,
  BFU_AMOUNTS,
  WORD_LENGTH_DELTA_BITS,
  DISTORTION_DELTA_FACTORS,
} from '../core/tables.js'

const biasedScaleFactorCache = new Map()

/**
 * Builds and returns a cached table of biased scale factors.
 *
 * @param {number} bias
 * @returns {Float64Array}
 */
function buildBiasedScaleFactorTable(bias) {
  if (biasedScaleFactorCache.has(bias)) {
    return biasedScaleFactorCache.get(bias)
  }

  const out = new Float64Array(64)
  if (bias === 1) {
    out.set(SCALE_FACTORS)
  } else {
    for (let i = 0; i < 64; i++) {
      out[i] = Math.pow(SCALE_FACTORS[i], bias)
    }
  }
  biasedScaleFactorCache.set(bias, out)
  return out
}

/**
 * Allocate bits by finding the optimal BFU count and distribution using RDO.
 * This function searches through the valid BFU counts to find the one that
 * minimizes the total perceptual distortion.
 *
 * @param {Array<Float32Array>} bfuData
 * @param {Int32Array} bfuSizes
 * @param {number} maxBfuCount
 * @param {number} allocationBias
 * @returns {{bfuCount:number, allocation:Int32Array, scaleFactorIndices:Int32Array}}
 */
export function solve(bfuData, bfuSizes, maxBfuCount, allocationBias) {
  const allScaleFactorIndices = new Int32Array(maxBfuCount)
  const zeroBitDistortions = new Float32Array(maxBfuCount)
  const biasedScaleFactors = buildBiasedScaleFactorTable(allocationBias)

  for (let i = 0; i < maxBfuCount; i++) {
    const sz = bfuSizes[i] | 0
    if (sz === 0) continue

    const sfi = findScaleFactor(bfuData[i], sz)
    allScaleFactorIndices[i] = sfi
    if (sfi > 0) {
      const effectiveScaleFactor = biasedScaleFactors[sfi]
      zeroBitDistortions[i] = effectiveScaleFactor * 2.0 * sz
    }
  }

  let bestResult = null
  let minTotalDistortion = Infinity

  for (const candidateBfuCount of BFU_AMOUNTS) {
    if (candidateBfuCount > maxBfuCount) continue

    const availableBits =
      FRAME_BITS -
      FRAME_OVERHEAD_BITS -
      candidateBfuCount * BITS_PER_BFU_METADATA

    if (availableBits < 0) continue

    const rdoResult = distributeBits(
      candidateBfuCount,
      bfuSizes,
      availableBits,
      biasedScaleFactors,
      allScaleFactorIndices
    )

    const totalDistortion = measureDistortion(
      candidateBfuCount,
      maxBfuCount,
      bfuSizes,
      rdoResult.wordLengths,
      rdoResult.scaleFactorIndices,
      biasedScaleFactors,
      zeroBitDistortions
    )

    if (totalDistortion < minTotalDistortion) {
      minTotalDistortion = totalDistortion
      bestResult = {
        bfuCount: candidateBfuCount,
        allocation: rdoResult.wordLengths,
        scaleFactorIndices: rdoResult.scaleFactorIndices,
      }
    }
  }

  if (!bestResult) {
    const fallbackBfuCount = BFU_AMOUNTS[0]
    return {
      bfuCount: fallbackBfuCount,
      allocation: new Int32Array(fallbackBfuCount),
      scaleFactorIndices: new Int32Array(NUM_BFUS),
    }
  }

  return bestResult
}

/**
 * Calculates the total distortion for a given allocation.
 * This includes quantization distortion for coded bands and truncation
 * distortion for uncoded bands.
 * @param {number} activeBfuCount
 * @param {number} maxBfuCount
 * @param {Int32Array} bfuSizes
 * @param {Int32Array} wordLengths
 * @param {Int32Array} scaleFactorIndices
 * @param {number} biasedScaleFactors
 * @param {Float32Array} zeroBitDistortions
 * @returns {number}
 */
function measureDistortion(
  activeBfuCount,
  maxBfuCount,
  bfuSizes,
  wordLengths,
  scaleFactorIndices,
  biasedScaleFactors,
  zeroBitDistortions
) {
  let totalDistortion = 0.0

  for (let i = 0; i < activeBfuCount; i++) {
    const wl = wordLengths[i] | 0
    const bits = WORD_LENGTH_BITS[wl] | 0
    if (bits === 0) {
      totalDistortion += zeroBitDistortions[i]
      continue
    }

    const sfi = scaleFactorIndices[i]
    if (sfi === 0) continue

    const effectiveScaleFactor = biasedScaleFactors[sfi]
    const distortionFactor = INV_POWER_OF_TWO[bits]

    totalDistortion += effectiveScaleFactor * distortionFactor * bfuSizes[i]
  }

  for (let i = activeBfuCount; i < maxBfuCount; i++) {
    totalDistortion += zeroBitDistortions[i]
  }

  return totalDistortion
}

/**
 * Distributes available bits across Band Frequency Units (BFUs) using Rate-Distortion Optimization.
 * (Modified to accept pre-calculated scale factors)
 *
 * @param {number} activeBfuCount
 * @param {Int32Array} bfuSizes
 * @param {number} remainingBits
 * @param {Float64Array} biasedScaleFactors
 * @param {Int32Array} allScaleFactorIndices
 * @returns {{wordLengths: Int32Array, scaleFactorIndices: Int32Array}}
 */
function distributeBits(
  activeBfuCount,
  bfuSizes,
  remainingBits,
  biasedScaleFactors,
  allScaleFactorIndices
) {
  const wordLengths = new Int32Array(activeBfuCount)

  const heapIndices = new Int32Array(activeBfuCount)
  const heapPriorities = new Float32Array(activeBfuCount)
  let heapSize = 0

  for (let bfuIndex = 0; bfuIndex < activeBfuCount; bfuIndex++) {
    const sz = bfuSizes[bfuIndex] | 0
    if (sz === 0) continue

    const sfi = allScaleFactorIndices[bfuIndex]
    if (sfi === 0) continue

    const deltaBits = WORD_LENGTH_DELTA_BITS[0]
    if (deltaBits <= 0) continue

    const distortionDelta =
      biasedScaleFactors[sfi] * DISTORTION_DELTA_FACTORS[0]

    heapIndices[heapSize] = bfuIndex
    heapPriorities[heapSize] = distortionDelta / deltaBits
    heapSize++
  }

  if (heapSize === 0) {
    return { wordLengths, scaleFactorIndices: allScaleFactorIndices }
  }

  // Heapify
  for (let i = (heapSize >> 1) - 1; i >= 0; i--) {
    siftDown(heapIndices, heapPriorities, i, heapSize)
  }

  // Greedy spending loop
  while (remainingBits > 0 && heapSize > 0) {
    const bfu = heapIndices[0]
    const cur = wordLengths[bfu] | 0
    const sz = bfuSizes[bfu] | 0
    const deltaBits = WORD_LENGTH_DELTA_BITS[cur]
    const cost = deltaBits * sz

    if (cost > remainingBits || cost <= 0) {
      const last = heapSize - 1
      heapIndices[0] = heapIndices[last]
      heapPriorities[0] = heapPriorities[last]
      heapSize--
      if (heapSize > 0) siftDown(heapIndices, heapPriorities, 0, heapSize)
      continue
    }

    remainingBits -= cost
    const nxt = cur + 1
    wordLengths[bfu] = nxt

    const deltaBitsNext = WORD_LENGTH_DELTA_BITS[nxt]
    if (nxt < MAX_WORD_LENGTH_INDEX && deltaBitsNext > 0) {
      const sfi = allScaleFactorIndices[bfu]
      const distortionDelta =
        biasedScaleFactors[sfi] * DISTORTION_DELTA_FACTORS[nxt]
      heapPriorities[0] = distortionDelta / deltaBitsNext
      siftDown(heapIndices, heapPriorities, 0, heapSize)
    } else {
      const last = heapSize - 1
      heapIndices[0] = heapIndices[last]
      heapPriorities[0] = heapPriorities[last]
      heapSize--
      if (heapSize > 0) siftDown(heapIndices, heapPriorities, 0, heapSize)
    }
  }

  return { wordLengths, scaleFactorIndices: allScaleFactorIndices }
}

/**
 * Find the optimal scale factor index for a set of coefficients.
 * Same semantics as the original.
 * @param {Float32Array} coefficients
 * @param {number} length
 * @returns {number}
 */
export function findScaleFactor(coefficients, length) {
  let maxAmplitude = 0.0
  for (let i = 0; i < length; i++) {
    const a = Math.abs(coefficients[i])
    if (a > maxAmplitude) maxAmplitude = a
  }
  if (maxAmplitude === 0) return 0
  const index = Math.ceil(3 * (Math.log2(maxAmplitude) + 21))
  return Math.max(0, Math.min(63, index))
}

/**
 * Restores max-heap property by sifting an element down from a given position.
 *
 * This function maintains the heap invariant where parent nodes have higher
 * priority values than their children. It compares the element at startIndex
 * with its children and swaps with the larger child until the heap property
 * is satisfied, or it reaches a leaf position.
 *
 * @param {Int32Array} heapIndices
 * @param {Float32Array} heapPriorities
 * @param {number} startIndex
 * @param {number} heapSize
 */
function siftDown(heapIndices, heapPriorities, startIndex, heapSize) {
  let i = startIndex
  const idxVal = heapIndices[i]
  const prVal = heapPriorities[i]

  while (true) {
    const l = (i << 1) + 1
    const r = l + 1
    let maxI = i
    let maxP = prVal

    if (l < heapSize && heapPriorities[l] > maxP) {
      maxI = l
      maxP = heapPriorities[l]
    }
    if (r < heapSize && heapPriorities[r] > maxP) {
      maxI = r
    }
    if (maxI === i) break

    heapIndices[i] = heapIndices[maxI]
    heapPriorities[i] = heapPriorities[maxI]
    i = maxI
  }

  heapIndices[i] = idxVal
  heapPriorities[i] = prVal
}
