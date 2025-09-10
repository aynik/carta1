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
  WORD_LENGTH_BITS,
  INV_POWER_OF_TWO,
  SCALE_FACTORS,
  BFU_AMOUNTS,
} from '../core/constants.js'

/**
 * Allocate bits by finding the optimal BFU count and distribution using RDO.
 * This function searches through the valid BFU counts to find the one that
 * minimizes the total perceptual distortion.
 *
 * @param {Array<Float32Array>} bfuData
 * @param {Int32Array} bfuSizes
 * @param {number} maxBfuCount The maximum BFU index to consider (e.g., from BFU_AMOUNTS)
 * @param {number} allocationBias
 * @returns {{bfuCount:number, allocation:Int32Array, scaleFactorIndices:Int32Array}}
 */
export function allocateBits(bfuData, bfuSizes, maxBfuCount, allocationBias) {
  const allScaleFactorIndices = new Int32Array(maxBfuCount)
  const zeroBitDistortions = new Float32Array(maxBfuCount)

  for (let i = 0; i < maxBfuCount; i++) {
    const sz = bfuSizes[i] | 0
    if (sz === 0) continue

    const sfi = findScaleFactor(bfuData[i].subarray(0, sz))
    allScaleFactorIndices[i] = sfi
    if (sfi > 0) {
      const scaleFactor = SCALE_FACTORS[sfi]
      const effectiveScaleFactor = Math.pow(scaleFactor, allocationBias)
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

    const rdoResult = distributeBitsRDO(
      candidateBfuCount,
      bfuSizes,
      availableBits,
      allocationBias,
      allScaleFactorIndices
    )

    const totalDistortion = calculateTotalDistortion(
      candidateBfuCount,
      maxBfuCount,
      bfuSizes,
      rdoResult.wordLengths,
      rdoResult.scaleFactorIndices,
      allocationBias,
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
 * @param {number} activeBfuCount - The number of BFUs that were coded.
 * @param {number} maxBfuCount - The total number of BFUs considered.
 * @param {Int32Array} bfuSizes - Sizes of each BFU.
 * @param {Int32Array} wordLengths - The allocated word length for each active BFU.
 * @param {Int32Array} scaleFactorIndices - The scale factor index for each BFU.
 * @param {number} allocationBias - The RDO bias factor.
 * @param {Float32Array} zeroBitDistortions - Pre-calculated distortion for uncoded bands.
 * @returns {number} The total calculated distortion.
 */
function calculateTotalDistortion(
  activeBfuCount,
  maxBfuCount,
  bfuSizes,
  wordLengths,
  scaleFactorIndices,
  allocationBias,
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

    const scaleFactor = SCALE_FACTORS[sfi]
    const effectiveScaleFactor = Math.pow(scaleFactor, allocationBias)
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
 * @param {number} allocationBias
 * @param {Int32Array} allScaleFactorIndices - Pre-calculated SFIs for all potential BFUs.
 * @returns {{wordLengths: Int32Array, scaleFactorIndices: Int32Array}}
 */
function distributeBitsRDO(
  activeBfuCount,
  bfuSizes,
  remainingBits,
  allocationBias,
  allScaleFactorIndices
) {
  const scaleFactorTable = allScaleFactorIndices
  const wordLengths = new Int32Array(activeBfuCount)

  const heapIndices = []
  const heapPriorities = []

  const deltaDistPerCoeff = (bfuIndex, currentWl, nextWl) => {
    const sfi = scaleFactorTable[bfuIndex]
    const scaleFactor = SCALE_FACTORS[sfi]
    if (scaleFactor === 0) return 0

    const effectiveScaleFactor = Math.pow(scaleFactor, allocationBias)

    const bits1 = WORD_LENGTH_BITS[currentWl] | 0
    const bits2 = WORD_LENGTH_BITS[nextWl] | 0

    const f1 = bits1 === 0 ? 2.0 : INV_POWER_OF_TWO[bits1]
    const f2 = INV_POWER_OF_TWO[bits2]

    return effectiveScaleFactor * (f1 - f2)
  }

  for (let bfuIndex = 0; bfuIndex < activeBfuCount; bfuIndex++) {
    const sz = bfuSizes[bfuIndex] | 0
    if (sz === 0) continue

    const sfi = scaleFactorTable[bfuIndex]
    if (sfi === 0) continue

    const currentWl = 0
    const nextWl = 1
    const deltaBits =
      (WORD_LENGTH_BITS[nextWl] - WORD_LENGTH_BITS[currentWl]) | 0
    if (deltaBits <= 0) continue

    const ddPerCoeff = deltaDistPerCoeff(bfuIndex, currentWl, nextWl)
    heapIndices.push(bfuIndex)
    heapPriorities.push(ddPerCoeff / deltaBits)
  }

  // Heapify
  for (let i = (heapIndices.length >> 1) - 1; i >= 0; i--)
    siftDown(heapIndices, heapPriorities, i)

  // Greedy spending
  while (remainingBits > 0 && heapIndices.length > 0) {
    const bfu = heapIndices[0]
    const cur = wordLengths[bfu] | 0
    const nxt = cur + 1

    const sz = bfuSizes[bfu] | 0
    const deltaBits = (WORD_LENGTH_BITS[nxt] - WORD_LENGTH_BITS[cur]) | 0
    const cost = deltaBits * sz

    if (cost > remainingBits || cost <= 0) {
      popRoot(heapIndices, heapPriorities)
      continue
    }

    remainingBits -= cost
    wordLengths[bfu] = nxt

    if (nxt < MAX_WORD_LENGTH_INDEX) {
      const nxt2 = nxt + 1
      const deltaBits2 = (WORD_LENGTH_BITS[nxt2] - WORD_LENGTH_BITS[nxt]) | 0
      if (deltaBits2 > 0) {
        heapPriorities[0] = deltaDistPerCoeff(bfu, nxt, nxt2) / deltaBits2
        siftDown(heapIndices, heapPriorities, 0)
      } else {
        popRoot(heapIndices, heapPriorities)
      }
    } else {
      popRoot(heapIndices, heapPriorities)
    }
  }

  return { wordLengths, scaleFactorIndices: scaleFactorTable }
}

/**
 * Find the optimal scale factor index for a set of coefficients.
 * Same semantics as the original.
 * @param {Float32Array} coefficients
 * @returns {number}
 */
export function findScaleFactor(coefficients) {
  let maxAmplitude = 0.0
  for (let i = 0; i < coefficients.length; i++) {
    const a = Math.abs(coefficients[i])
    if (a > maxAmplitude) maxAmplitude = a
  }
  if (maxAmplitude === 0) return 0
  const index = Math.ceil(3 * (Math.log2(maxAmplitude) + 21))
  return Math.max(0, Math.min(63, index))
}

/**
 * Removes the root element from a max-heap and maintains heap property.
 *
 * This function efficiently removes the maximum priority element from the heap
 * by replacing it with the last element and then restoring the heap property
 * through sifting down.
 *
 * @param {Array<number>} heapIndices
 * @param {Array<number>} heapPriorities
 */
function popRoot(heapIndices, heapPriorities) {
  const last = heapIndices.length - 1
  heapIndices[0] = heapIndices[last]
  heapPriorities[0] = heapPriorities[last]
  heapIndices.pop()
  heapPriorities.pop()
  if (heapIndices.length) siftDown(heapIndices, heapPriorities, 0)
}

/**
 * Restores max-heap property by sifting an element down from a given position.
 *
 * This function maintains the heap invariant where parent nodes have higher
 * priority values than their children. It compares the element at startIndex
 * with its children and swaps with the larger child until the heap property
 * is satisfied, or it reaches a leaf position.
 *
 * @param {Array<number>} heapIndices
 * @param {Array<number>} heapPriorities
 * @param {number} startIndex
 */
function siftDown(heapIndices, heapPriorities, startIndex) {
  const heapSize = heapIndices.length
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
