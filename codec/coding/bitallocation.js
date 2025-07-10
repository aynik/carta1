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
  PSYMODEL_MIN_POWER_DB,
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

  // Map psychoacoustic masking threshold to BFUs
  const maskingThreshold =
    psychoResults.maskingThreshold || psychoResults.globalThreshold
  const maskThresholdDb = mapThresholdToBfus(maskingThreshold)

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

    // Convert to dB (10 * log10(energy/size))
    energyPerBfu[i] =
      energy > 0 ? 10 * Math.log10(energy / size) : PSYMODEL_MIN_POWER_DB
  }

  return energyPerBfu
}

/**
 * Map frequency-domain masking threshold to BFU indices
 * @param {Float32Array} globalThreshold - Frequency-domain masking threshold
 * @returns {Float32Array} Masking threshold per BFU
 */
function mapThresholdToBfus(globalThreshold) {
  const maskThresholdPerBfu = new Float32Array(NUM_BFUS)
  maskThresholdPerBfu.fill(PSYMODEL_MIN_POWER_DB)

  // Calculate frequency resolution
  const fftSize = (globalThreshold.length - 1) * 2
  const freqPerBin = SAMPLE_RATE / fftSize

  // Map each BFU's center frequency to nearest FFT bin
  for (let i = 0; i < NUM_BFUS; i++) {
    const bfuFreq = BFU_FREQUENCIES[i]
    const fftBinIndex = Math.round(bfuFreq / freqPerBin)

    if (fftBinIndex >= 0 && fftBinIndex < globalThreshold.length) {
      maskThresholdPerBfu[i] = globalThreshold[fftBinIndex]
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
    // BFUs with no signal have undefined SMR
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
    return selectBfuCountForAudibleContent(smrValues, maxBfuCount)
  } else {
    return selectBfuCountForInaudibleContent(
      smrValues,
      signalEnergyDb,
      maxBfuCount
    )
  }
}

/**
 * Select BFU count when content is above masking threshold
 * Uses diminishing returns approach - find where adding more BFUs
 * provides minimal benefit
 */
function selectBfuCountForAudibleContent(smrValues, maxBfuCount) {
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
      const currentValue = cumulativeSMR[capturedIndex]
      const totalValue = cumulativeSMR[cumulativeSMR.length - 1]
      const remainingIndices = contributions.length - capturedIndex - 1

      if (remainingIndices > 0) {
        const averageRemaining = (totalValue - currentValue) / remainingIndices
        const averageCaptured = currentValue / (capturedIndex + 1)

        // If remaining BFUs contribute much less on average, we've found our cutoff
        if (averageRemaining < averageCaptured * 0.1) {
          return candidateCount
        }
      }
    }
  }

  return BFU_AMOUNTS[BFU_AMOUNTS.length - 1]
}

/**
 * Select BFU count when all content is below masking threshold
 * Simply finds the smallest count that includes all BFUs with signal
 */
function selectBfuCountForInaudibleContent(
  smrValues,
  signalEnergyDb,
  maxBfuCount
) {
  // Find the highest BFU index that contains actual signal
  let highestSignalBfu = -1

  for (let i = maxBfuCount - 1; i >= 0; i--) {
    if (signalEnergyDb[i] > PSYMODEL_MIN_POWER_DB && smrValues[i] > -Infinity) {
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

  return BFU_AMOUNTS[BFU_AMOUNTS.length - 1]
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
  const allocation = new Int32Array(actualBfuCount).fill(0)

  // Initialize priority queue with BFUs that have signal
  const priorityQueue = createPriorityQueue(smrValues, actualBfuCount)

  // Greedy allocation: always upgrade BFU with highest priority
  while (!priorityQueue.isEmpty()) {
    const bestBfu = priorityQueue.peek()
    const currentWl = allocation[bestBfu.bfu]

    // Check if BFU is already at maximum word length
    if (currentWl >= MAX_WORD_LENGTH_INDEX) {
      priorityQueue.pop()
      continue
    }

    // Calculate cost to upgrade this BFU
    const upgradeCost = calculateUpgradeCost(bestBfu.bfu, currentWl, bfuSizes)

    if (upgradeCost <= availableBits) {
      // Perform upgrade
      availableBits -= upgradeCost
      allocation[bestBfu.bfu]++

      // Update priority based on distortion reduction
      bestBfu.priority += DISTORTION_DELTA_DB[currentWl]
      priorityQueue.updateTop()
    } else {
      // Not enough bits for this BFU
      priorityQueue.pop()
    }
  }

  return allocation
}

/**
 * Calculate bit cost to upgrade a BFU's word length
 */
function calculateUpgradeCost(bfuIndex, currentWl, bfuSizes) {
  const currentBits = WORD_LENGTH_BITS[currentWl] * bfuSizes[bfuIndex]
  const nextBits = WORD_LENGTH_BITS[currentWl + 1] * bfuSizes[bfuIndex]
  return nextBits - currentBits
}

/**
 * Create a priority queue for BFU allocation
 * @param {Float32Array} smrValues - Initial priorities (SMR values)
 * @param {number} bfuCount - Number of BFUs
 * @returns {Object} Priority queue interface
 */
function createPriorityQueue(smrValues, bfuCount) {
  const heap = []

  // Initialize with BFUs that have signal
  for (let i = 0; i < bfuCount; i++) {
    if (smrValues[i] > -Infinity) {
      heap.push({ bfu: i, priority: smrValues[i] })
    }
  }

  // Build max heap
  for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) {
    heapifyDown(heap, i)
  }

  return {
    isEmpty: () => heap.length === 0,
    peek: () => heap[0],
    pop: () => popMax(heap),
    updateTop: () => heapifyDown(heap, 0),
  }
}

/**
 * Maintain max heap property by moving element down
 * @param {Array} heap - Heap array
 * @param {number} startIdx - Starting index
 */
function heapifyDown(heap, startIdx) {
  let idx = startIdx
  const element = heap[idx]
  const length = heap.length

  while (true) {
    const leftChild = 2 * idx + 1
    const rightChild = 2 * idx + 2
    let largest = idx
    let largestPriority = element.priority

    // Find largest among parent and children
    if (leftChild < length && heap[leftChild].priority > largestPriority) {
      largest = leftChild
      largestPriority = heap[leftChild].priority
    }

    if (rightChild < length && heap[rightChild].priority > largestPriority) {
      largest = rightChild
    }

    // If parent is largest, we're done
    if (largest === idx) break

    // Swap and continue
    heap[idx] = heap[largest]
    idx = largest
  }

  heap[idx] = element
}

/**
 * Remove and return the maximum element from heap
 * @param {Array} heap - Heap array
 * @returns {Object} Maximum element
 */
function popMax(heap) {
  const max = heap[0]
  const last = heap.pop()

  if (heap.length > 0) {
    heap[0] = last
    heapifyDown(heap, 0)
  }

  return max
}
