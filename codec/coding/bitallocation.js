/**
 * Carta1 Audio Codec - Bit Allocation Module
 *
 * This module implements the bit allocation algorithm for ATRAC1 compression,
 * distributing available bits among Block Floating Units (BFUs) based on
 * psychoacoustic masking and signal-to-mask ratios.
 */

import {
  FRAME_BITS,
  FRAME_OVERHEAD_BITS,
  BITS_PER_BFU_METADATA,
  BFU_AMOUNTS,
  MAX_WORD_LENGTH_INDEX,
  WORD_LENGTH_BITS,
  DISTORTION_DELTA_DB,
  NUM_BFUS,
  SAMPLE_RATE,
  BFU_FREQUENCIES,
  BFU_AMOUNTS_COUNT,
  PSYMODEL_MIN_POWER_DB,
  PSYMODEL_CB_FREQ_INDICES,
  INTERPOLATION_COMPENSATION_FACTOR,
  PSYMODEL_FFT_SIZE,
} from '../core/constants.js'

/**
 * Allocate bits to BFUs based on psychoacoustic analysis
 * @param {Object} psychoResults - Psychoacoustic analysis results
 * @param {Array} bfuData - BFU coefficient data
 * @param {Array} bfuSizes - Size of each BFU
 * @param {number} maxBfuCount - Maximum number of BFUs to use
 * @returns {Object} Allocation results with BFU count and bit distribution
 */
export function allocateBits(psychoResults, bfuData, bfuSizes, maxBfuCount) {
  // Calculate signal energy for each BFU
  const signalEnergyDb = calculateBfuEnergy(bfuData, bfuSizes, maxBfuCount)

  // Interpolate critical band thresholds to BFUs
  const maskThresholdDb = interpolateCriticalBandsToBfus(
    psychoResults.criticalBandThresholds
  )

  // Calculate Signal-to-Mask Ratios
  const smrValues = calculateSMR(signalEnergyDb, maskThresholdDb, maxBfuCount)

  // Determine optimal number of BFUs to use
  const actualBfuCount = selectOptimalBfuCount(
    smrValues,
    signalEnergyDb,
    maxBfuCount
  )

  // Calculate available bits for allocation
  const availableBits =
    FRAME_BITS - FRAME_OVERHEAD_BITS - actualBfuCount * BITS_PER_BFU_METADATA

  // Perform actual bit allocation
  const allocation = performBitAllocation(
    actualBfuCount,
    smrValues,
    bfuSizes,
    availableBits
  )

  return {
    bfuCount: actualBfuCount,
    allocation,
  }
}

/**
 * Calculate energy in dB for each BFU
 * @param {Array} bfuData - BFU coefficient data
 * @param {Array} bfuSizes - Size of each BFU
 * @param {number} bfuCount - Number of BFUs to process
 * @returns {Float32Array} Energy values in dB
 */
function calculateBfuEnergy(bfuData, bfuSizes, bfuCount) {
  const energyPerBfu = new Float32Array(bfuCount)

  for (let i = 0; i < bfuCount; i++) {
    const data = bfuData[i]
    const size = bfuSizes[i]

    if (size === 0) {
      energyPerBfu[i] = PSYMODEL_MIN_POWER_DB
      continue
    }

    // Calculate mean square energy
    let energy = 0
    for (let j = 0; j < size; j++) {
      energy += data[j] * data[j]
    }

    // Convert to dB correctly using log10
    energyPerBfu[i] =
      energy > 0 ? 10 * Math.log10(energy / size) : PSYMODEL_MIN_POWER_DB
  }

  return energyPerBfu
}

/**
 * Interpolate critical band thresholds directly to BFU frequencies
 * @param {Float32Array} criticalBandThresholds - Critical band thresholds
 * @returns {Float32Array} Masking threshold per BFU
 */
function interpolateCriticalBandsToBfus(criticalBandThresholds) {
  const maskThresholdPerBfu = new Float32Array(NUM_BFUS)
  const freqPerBin = SAMPLE_RATE / PSYMODEL_FFT_SIZE

  for (let i = 0; i < NUM_BFUS; i++) {
    const bfuFreq = BFU_FREQUENCIES[i]
    const fftBinIndex = Math.round(bfuFreq / freqPerBin)

    // Find which critical bands surround this FFT bin
    let bandIndex = 0
    while (
      bandIndex < PSYMODEL_CB_FREQ_INDICES.length - 1 &&
      PSYMODEL_CB_FREQ_INDICES[bandIndex + 1] < fftBinIndex
    ) {
      bandIndex++
    }

    if (fftBinIndex <= PSYMODEL_CB_FREQ_INDICES[0]) {
      maskThresholdPerBfu[i] = criticalBandThresholds[0]
    } else if (
      fftBinIndex >=
      PSYMODEL_CB_FREQ_INDICES[PSYMODEL_CB_FREQ_INDICES.length - 1]
    ) {
      maskThresholdPerBfu[i] =
        criticalBandThresholds[criticalBandThresholds.length - 1]
    } else {
      const x0 = PSYMODEL_CB_FREQ_INDICES[bandIndex]
      const x1 = PSYMODEL_CB_FREQ_INDICES[bandIndex + 1]
      const y0 = criticalBandThresholds[bandIndex]
      const y1 = criticalBandThresholds[bandIndex + 1]
      const bandWidth = x1 - x0

      if (bandWidth > 0) {
        const t = (fftBinIndex - x0) / bandWidth
        const interpolated = y0 + (y1 - y0) * t
        const compensation =
          Math.abs(y1 - y0) * INTERPOLATION_COMPENSATION_FACTOR
        maskThresholdPerBfu[i] = interpolated + compensation
      } else {
        maskThresholdPerBfu[i] = y0
      }
    }
  }

  return maskThresholdPerBfu
}

/**
 * Calculate Signal-to-Mask Ratio for each BFU
 * @param {Float32Array} signalEnergyDb - Signal energy per BFU
 * @param {Float32Array} maskThresholdDb - Masking threshold per BFU
 * @param {number} maxBfuCount - Maximum number of BFUs
 * @returns {Float32Array} SMR values in dB
 */
function calculateSMR(signalEnergyDb, maskThresholdDb, maxBfuCount) {
  const smrValues = new Float32Array(maxBfuCount)

  for (let bfu = 0; bfu < maxBfuCount; bfu++) {
    smrValues[bfu] =
      signalEnergyDb[bfu] <= PSYMODEL_MIN_POWER_DB
        ? -Infinity
        : signalEnergyDb[bfu] - maskThresholdDb[bfu]
  }

  return smrValues
}

/**
 * Select optimal number of BFUs to use based on SMR distribution
 * @param {Float32Array} smrValues - Signal-to-Mask ratios
 * @param {Float32Array} signalEnergyDb - Signal energy per BFU
 * @param {number} maxBfuCount - Maximum available BFUs
 * @returns {number} Optimal BFU count
 */
function selectOptimalBfuCount(smrValues, signalEnergyDb, maxBfuCount) {
  // Check if we have any audible content (positive SMR)
  const hasAudibleContent = smrValues.some((smr) => smr > 0)

  if (hasAudibleContent) {
    // Create sorted list of BFUs by their contribution (positive SMR only)
    const contributions = []
    for (let i = 0; i < maxBfuCount; i++) {
      if (smrValues[i] > 0) {
        contributions.push({ index: i, smr: smrValues[i] })
      }
    }
    contributions.sort((a, b) => b.smr - a.smr)

    if (contributions.length === 0) {
      return BFU_AMOUNTS[BFU_AMOUNTS.length - 1]
    }

    // Find the natural cutoff using gradient of cumulative SMR
    const cumulativeSMR = []
    let sum = 0
    for (let i = 0; i < contributions.length; i++) {
      sum += contributions[i].smr
      cumulativeSMR.push(sum)
    }

    // Find where the gradient becomes shallow (diminishing returns)
    for (const candidateCount of BFU_AMOUNTS) {
      if (candidateCount > maxBfuCount) continue

      // Check if all significant contributions fit within this count
      const requiredBfus = contributions
        .slice(0, Math.min(contributions.length, candidateCount))
        .map((c) => c.index)

      const maxRequiredIndex = Math.max(...requiredBfus, 0)

      if (maxRequiredIndex < candidateCount) {
        // Check if we've captured the bulk of the contribution
        const capturedIndex = Math.min(
          candidateCount - 1,
          contributions.length - 1
        )
        if (capturedIndex >= contributions.length - 1) {
          return candidateCount
        }

        // Use gradient to detect diminishing returns
        const remainingIndices = contributions.length - capturedIndex - 1
        if (remainingIndices > 0) {
          const avgRemaining =
            (cumulativeSMR[cumulativeSMR.length - 1] -
              cumulativeSMR[capturedIndex]) /
            remainingIndices
          const avgCaptured = cumulativeSMR[capturedIndex] / (capturedIndex + 1)

          // If remaining BFUs contribute much less on average, we've found our cutoff
          if (avgRemaining < avgCaptured * 0.1) {
            return candidateCount
          }
        }
      }
    }
  } else {
    // Find the highest BFU index that contains actual signal
    let highestSignalBfu = -1
    for (let i = maxBfuCount - 1; i >= 0; i--) {
      if (
        signalEnergyDb[i] > PSYMODEL_MIN_POWER_DB &&
        smrValues[i] > -Infinity
      ) {
        highestSignalBfu = i
        break
      }
    }

    // Find smallest BFU count that includes all signal
    for (const candidateCount of BFU_AMOUNTS) {
      if (candidateCount > highestSignalBfu) {
        return candidateCount
      }
    }
  }

  return BFU_AMOUNTS[BFU_AMOUNTS_COUNT - 1]
}

/**
 * Allocate available bits among BFUs using a greedy algorithm
 * @param {number} actualBfuCount - Number of BFUs to allocate
 * @param {Float32Array} smrValues - Signal-to-Mask ratios
 * @param {Array} bfuSizes - Size of each BFU
 * @param {number} availableBits - Total bits available for allocation
 * @returns {Int32Array} Word length index allocation per BFU
 */
function performBitAllocation(
  actualBfuCount,
  smrValues,
  bfuSizes,
  availableBits
) {
  const allocation = new Int32Array(actualBfuCount)
  const heap = []

  // Initialize heap with BFUs that have signal
  for (let i = 0; i < actualBfuCount; i++) {
    if (smrValues[i] > -Infinity) {
      heap.push({ bfu: i, priority: smrValues[i] })
    }
  }

  // Build max heap
  for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) {
    heapifyDown(heap, i)
  }

  // Greedy allocation
  while (heap.length > 0 && availableBits > 0) {
    const bestBfu = heap[0]
    const currentWl = allocation[bestBfu.bfu]

    if (currentWl >= MAX_WORD_LENGTH_INDEX) {
      heap[0] = heap[heap.length - 1]
      heap.pop()
      if (heap.length > 0) heapifyDown(heap, 0)
      continue
    }

    const upgradeCost = calculateUpgradeCost(bestBfu.bfu, currentWl, bfuSizes)

    if (upgradeCost <= availableBits) {
      availableBits -= upgradeCost
      allocation[bestBfu.bfu]++
      bestBfu.priority += DISTORTION_DELTA_DB[currentWl]
      heapifyDown(heap, 0)
    } else {
      heap[0] = heap[heap.length - 1]
      heap.pop()
      if (heap.length > 0) heapifyDown(heap, 0)
    }
  }

  return allocation
}

/**
 * Calculate bit cost to upgrade a BFU's word length
 * @param {number} bfuIndex - Index of the BFU to upgrade
 * @param {number} currentWl - Current word length of the BFU
 * @param {number[]} bfuSizes - Array of BFU sizes (number of coefficients per BFU)
 * @returns {number} Additional bits required to upgrade word length by 1
 */
function calculateUpgradeCost(bfuIndex, currentWl, bfuSizes) {
  const currentBits = WORD_LENGTH_BITS[currentWl] * bfuSizes[bfuIndex]
  const nextBits = WORD_LENGTH_BITS[currentWl + 1] * bfuSizes[bfuIndex]
  return nextBits - currentBits
}

/**
 * Maintain max heap property by moving element down
 * @param {Array} heap - Heap array
 * @param {number} startIdx - Starting index
 */
function heapifyDown(heap, startIdx) {
  const length = heap.length
  const element = heap[startIdx]

  while (true) {
    const leftChild = 2 * startIdx + 1
    const rightChild = 2 * startIdx + 2
    let largest = startIdx
    let largestPriority = element.priority

    if (leftChild < length && heap[leftChild].priority > largestPriority) {
      largest = leftChild
      largestPriority = heap[leftChild].priority
    }

    if (rightChild < length && heap[rightChild].priority > largestPriority) {
      largest = rightChild
    }

    if (largest === startIdx) break

    heap[startIdx] = heap[largest]
    startIdx = largest
  }

  heap[startIdx] = element
}
