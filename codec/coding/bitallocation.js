/**
 * Carta1 Audio Codec - Bit Allocation Module
 *
 * This module implements the bit allocation system for the Carta1 audio codec,
 * responsible for distributing available bits across frequency bands to minimize
 * perceptual distortion while maintaining the target bitrate.
 *
 * The module uses Rate-Distortion Optimization (RDO) with a greedy algorithm
 * that allocates bits to Band Frequency Units (BFUs) based on the perceptual
 * benefit per bit spent. It employs psychoacoustic modeling to determine
 * scale factors and uses a priority queue to efficiently find the optimal
 * bit distribution.
 *
 * Key components:
 * - RDO-based bit allocation using exponential distortion modeling
 * - Scale factor computation for each frequency band
 * - Max-heap priority queue for greedy optimization
 * - Support for variable word lengths per BFU
 *
 * The algorithm ensures that bits are allocated where they provide the
 * greatest reduction in audible distortion, resulting in high-quality
 * audio compression at the target bitrate.
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
} from '../core/constants.js'

/**
 * Allocate bits to BFUs using optimized greedy Lp-RDO
 * @param {Array<Float64Array>} bfuData
 * @param {Int32Array} bfuSizes
 * @param {number} maxBfuCount
 * @returns {{bfuCount:number, allocation:Int32Array, scaleFactorIndices:Int32Array}}
 */
export function allocateBits(bfuData, bfuSizes, maxBfuCount) {
  const usedBFU = maxBfuCount
  const avail =
    FRAME_BITS - FRAME_OVERHEAD_BITS - usedBFU * BITS_PER_BFU_METADATA

  const rdoResult = distributeBitsRDO(usedBFU, bfuData, bfuSizes, avail)

  return {
    bfuCount: usedBFU,
    allocation: rdoResult.wordLengths,
    scaleFactorIndices: rdoResult.scaleFactorIndices,
  }
}

/**
 * Distributes available bits across Band Frequency Units (BFUs) using Rate-Distortion Optimization.
 *
 * This function implements an optimized greedy RDO allocator that minimizes perceptual distortion
 * while staying within the bit budget. It uses a priority queue (max-heap) to greedily allocate
 * bits to the BFUs that provide the greatest distortion reduction per bit spent.
 *
 * @param {number} activeBfuCount
 * @param {Array<Float64Array>} bfuData
 * @param {Int32Array} bfuSizes
 * @param {number} remainingBits
 * @returns {{wordLengths: Int32Array, scaleFactorIndices: Int32Array}}
 */
function distributeBitsRDO(activeBfuCount, bfuData, bfuSizes, remainingBits) {
  const scaleFactorTable = new Int32Array(NUM_BFUS)
  const wordLengths = new Int32Array(activeBfuCount)

  const heapIndices = []
  const heapPriorities = []

  const deltaDistPerCoeff = (bfuIndex, currentWl, nextWl) => {
    const sfi = scaleFactorTable[bfuIndex]
    const scaleFactor = SCALE_FACTORS[sfi]
    if (scaleFactor === 0) return 0

    const bits1 = WORD_LENGTH_BITS[currentWl] | 0
    const bits2 = WORD_LENGTH_BITS[nextWl] | 0

    const f1 = bits1 === 0 ? 2.0 : INV_POWER_OF_TWO[bits1]
    const f2 = INV_POWER_OF_TWO[bits2]

    return scaleFactor * (f1 - f2)
  }

  for (let bfuIndex = 0; bfuIndex < activeBfuCount; bfuIndex++) {
    const sz = bfuSizes[bfuIndex] | 0
    if (sz === 0) continue

    const sfi = findScaleFactor(bfuData[bfuIndex].subarray(0, sz))
    scaleFactorTable[bfuIndex] = sfi

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
 * @param {Float64Array} coefficients
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
