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
  LP_DISTORTION_CONSTANT,
  SF_POW_P,
  POW2_POS_P,
  POW2_NEG_P,
  SCALE_FACTORS,
} from '../core/constants.js'

/**
 * Allocate bits to BFUs using optimized greedy Lp-RDO
 * @param {Array<Float32Array>} bfuData
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
 * Mathematical Model:
 * Distortion for b bits is modeled as:
 *   D(b) = C * 2^{-p * b}            for b >= 1
 *   D(0) = C * 2^{ p }               (finite large step for "mute" case)
 * where C = N * (sf^p) * k, with N = BFU length, sf = scale factor, p and k constants.
 *
 * Hence, for an upgrade from b1 -> b2 (b2 > b1), ΔD = D(b1) - D(b2) can be computed with 2 table lookups.
 *
 * Precomputed tables:
 *   POW2_NEG_P[b] = 2^{-p*b}   for b=0..maxBits
 *   POW2_POS_P    = 2^{ p}
 *   SF_POW_P[sfIndex] = (SCALE_FACTORS[sfIndex])^p
 *
 * @param {number} activeBfuCount
 * @param {Array<Float32Array>} bfuData
 * @param {Int32Array} bfuSizes
 * @param {number} remainingBits
 * @returns {{wordLengths: Int32Array, scaleFactorIndices: Int32Array}}
 */
function distributeBitsRDO(activeBfuCount, bfuData, bfuSizes, remainingBits) {
  const scaleFactorTable = new Int32Array(NUM_BFUS)
  const wordLengths = new Int32Array(activeBfuCount)

  const baseWeight = new Float64Array(activeBfuCount) // C above
  for (let bfuIndex = 0; bfuIndex < activeBfuCount; bfuIndex++) {
    const sz = bfuSizes[bfuIndex] | 0
    if (sz > 0) {
      const sfi = findScaleFactor(bfuData[bfuIndex].subarray(0, sz))
      scaleFactorTable[bfuIndex] = sfi
      baseWeight[bfuIndex] = sz * SF_POW_P[sfi] * LP_DISTORTION_CONSTANT
    } else {
      scaleFactorTable[bfuIndex] = 0
      baseWeight[bfuIndex] = 0
    }
  }

  const heapIndices = []
  const heapPriorities = []
  const deltaDist = (bfuIndex, currentWl, nextWl) => {
    const base = baseWeight[bfuIndex]
    if (base === 0) return 0

    const bits1 = WORD_LENGTH_BITS[currentWl] | 0
    const bits2 = WORD_LENGTH_BITS[nextWl] | 0

    const f1 = bits1 === 0 ? POW2_POS_P : POW2_NEG_P[bits1]
    const f2 = POW2_NEG_P[bits2]

    return base * (f1 - f2)
  }

  for (let bfuIndex = 0; bfuIndex < activeBfuCount; bfuIndex++) {
    const sz = bfuSizes[bfuIndex] | 0
    if (sz === 0) continue
    if (scaleFactorTable[bfuIndex] === 0) continue

    const currentWl = 0
    const nextWl = 1
    const deltaBits =
      (WORD_LENGTH_BITS[nextWl] - WORD_LENGTH_BITS[currentWl]) | 0
    if (deltaBits <= 0) continue

    const deltaCost = deltaBits * sz
    const dd = deltaDist(bfuIndex, currentWl, nextWl)

    heapIndices.push(bfuIndex)
    heapPriorities.push(dd / deltaCost) // priority = ΔD / ΔR
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
        heapPriorities[0] = deltaDist(bfu, nxt, nxt2) / (deltaBits2 * sz)
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
  const n = coefficients.length | 0
  let i = 0
  const n4 = n & ~3
  for (; i < n4; i += 4) {
    const a0 = Math.abs(coefficients[i])
    const a1 = Math.abs(coefficients[i + 1])
    const a2 = Math.abs(coefficients[i + 2])
    const a3 = Math.abs(coefficients[i + 3])
    if (a0 > maxAmplitude) maxAmplitude = a0
    if (a1 > maxAmplitude) maxAmplitude = a1
    if (a2 > maxAmplitude) maxAmplitude = a2
    if (a3 > maxAmplitude) maxAmplitude = a3
  }
  for (; i < n; i++) {
    const a = Math.abs(coefficients[i])
    if (a > maxAmplitude) maxAmplitude = a
  }
  if (maxAmplitude === 0) return 0

  // Binary search
  let low = 0
  let high = SCALE_FACTORS.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (maxAmplitude <= SCALE_FACTORS[mid]) {
      high = mid
    } else {
      low = mid + 1
    }
  }
  return low
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
