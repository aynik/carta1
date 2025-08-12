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
  PSYMODEL_MIN_POWER_DB,
  INTERPOLATION_COMPENSATION_FACTOR,
  BFU_MASK_INTERPOLATION_TABLE,
  BFU_FREQUENCIES,
  NUM_BFUS,
  SAMPLE_RATE,
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
  const energyDb = calculateBfuEnergy(bfuData, bfuSizes, maxBfuCount)
  const maskDb = interpolateMask(psychoResults.criticalBandThresholds)
  const smr = calculateSMR(energyDb, maskDb, maxBfuCount)
  const usedBFU = selectOptimalBfuCount(smr, energyDb, maxBfuCount)
  const avail =
    FRAME_BITS - FRAME_OVERHEAD_BITS - usedBFU * BITS_PER_BFU_METADATA
  const allocation = distributeBitsGreedy(usedBFU, smr, bfuSizes, avail)
  return { bfuCount: usedBFU, allocation }
}

/**
 * Calculate energy in dB for each BFU
 * @param {Array} bfuData - BFU coefficient bfuData
 * @param {Array} bfuSizes - Size of each BFU
 * @param {number} bfuCount - Number of BFUs to process
 * @returns {Float32Array} Energy values in dB
 */
function calculateBfuEnergy(bfuData, bfuSizes, bfuCount) {
  const out = new Float32Array(bfuCount)
  const minDb = PSYMODEL_MIN_POWER_DB
  for (let i = 0; i < bfuCount; i++) {
    const sz = bfuSizes[i]
    if (!sz) {
      out[i] = minDb
      continue
    }
    let sum = 0,
      buf = bfuData[i]
    for (let j = 0; j < sz; j++) sum += buf[j] * buf[j]
    out[i] = sum > 0 ? 10 * Math.log10(sum / sz) : minDb
  }
  return out
}

/**
 * Interpolate psychoacoustic masking thresholds from critical bands to BFU frequencies
 * @param {Float32Array} criticalBandThresholds - Masking thresholds for each critical band
 * @returns {Float32Array} Interpolated masking thresholds for each BFU
 */
function interpolateMask(criticalBandThresholds) {
  const maskValues = new Float32Array(NUM_BFUS)

  for (let bfuIndex = 0; bfuIndex < NUM_BFUS; bfuIndex++) {
    const interpolationEntry = BFU_MASK_INTERPOLATION_TABLE[bfuIndex]
    const currentBandThreshold = criticalBandThresholds[interpolationEntry.band]
    const nextBandThreshold = criticalBandThresholds[interpolationEntry.next]

    // Calculate interpolation parameter t based on BFU frequency position
    const normalizedFreqPosition =
      (Math.round(
        BFU_FREQUENCIES[bfuIndex] / (SAMPLE_RATE / PSYMODEL_FFT_SIZE)
      ) -
        interpolationEntry.x0) *
      interpolationEntry.tInv

    const interpolatedValue =
      currentBandThreshold +
      (nextBandThreshold - currentBandThreshold) * normalizedFreqPosition

    // Add compensation factor based on threshold difference
    maskValues[bfuIndex] =
      interpolatedValue +
      Math.abs(nextBandThreshold - currentBandThreshold) *
        INTERPOLATION_COMPENSATION_FACTOR
  }

  return maskValues
}

/**
 * Calculate Signal-to-Mask Ratios (SMR) for each BFU
 * SMR determines how much energy exceeds the masking threshold
 * @param {Float32Array} energyDb - Energy values in dB for each BFU
 * @param {Float32Array} maskDb - Masking threshold values in dB for each BFU
 * @param {number} bfuCount - Number of BFUs to process
 * @returns {Float32Array} SMR values for each BFU (-Infinity for inaudible BFUs)
 */
function calculateSMR(energyDb, maskDb, bfuCount) {
  const smrValues = new Float32Array(bfuCount)

  for (let bfuIndex = 0; bfuIndex < bfuCount; bfuIndex++) {
    const energyValue = energyDb[bfuIndex]
    smrValues[bfuIndex] =
      energyValue <= PSYMODEL_MIN_POWER_DB
        ? -Infinity
        : energyValue - maskDb[bfuIndex]
  }

  return smrValues
}

/**
 * Determine optimal number of BFUs to use based on SMR analysis
 * Uses cumulative SMR analysis to find the point of diminishing returns
 * @param {Float32Array} smrValues - Signal-to-Mask ratios for each BFU
 * @param {Float32Array} energyValues - Energy values for each BFU
 * @param {number} maxBfuCount - Maximum BFUs available
 * @returns {number} Optimal number of BFUs to use for encoding
 */
function selectOptimalBfuCount(smrValues, energyValues, maxBfuCount) {
  // Collect BFUs with positive SMR (above masking threshold)
  const positiveSMRBfus = []
  for (let bfuIndex = 0; bfuIndex < maxBfuCount; bfuIndex++) {
    if (smrValues[bfuIndex] > 0) {
      positiveSMRBfus.push({
        index: bfuIndex,
        smrValue: smrValues[bfuIndex],
      })
    }
  }

  // If no BFUs have positive SMR, fall back to energy-based selection
  if (!positiveSMRBfus.length) {
    for (let bfuIndex = maxBfuCount - 1; bfuIndex >= 0; bfuIndex--) {
      if (energyValues[bfuIndex] > PSYMODEL_MIN_POWER_DB) {
        return (
          BFU_AMOUNTS.find((count) => count > bfuIndex) ||
          BFU_AMOUNTS[BFU_AMOUNTS.length - 1]
        )
      }
    }
    return BFU_AMOUNTS[0]
  }

  // Sort BFUs by SMR value (highest first)
  positiveSMRBfus.sort((a, b) => b.smrValue - a.smrValue)

  // Calculate cumulative SMR values
  const cumulativeSmr = new Float32Array(positiveSMRBfus.length)
  cumulativeSmr[0] = positiveSMRBfus[0].smrValue
  for (let k = 1; k < positiveSMRBfus.length; k++) {
    cumulativeSmr[k] = cumulativeSmr[k - 1] + positiveSMRBfus[k].smrValue
  }

  // Find optimal cutoff point using diminishing returns analysis
  for (const candidateCount of BFU_AMOUNTS) {
    if (candidateCount > maxBfuCount) continue
    if (positiveSMRBfus.length <= candidateCount) return candidateCount

    const lastIncludedIndex = candidateCount - 1
    const averageIncludedSmr =
      cumulativeSmr[lastIncludedIndex] / (lastIncludedIndex + 1)
    const averageExcludedSmr =
      (cumulativeSmr[positiveSMRBfus.length - 1] -
        cumulativeSmr[lastIncludedIndex]) /
      (positiveSMRBfus.length - lastIncludedIndex - 1)

    // If excluded BFUs contribute less than 10% of included average, use this count
    if (averageExcludedSmr < averageIncludedSmr * 0.1) return candidateCount
  }

  return BFU_AMOUNTS[BFU_AMOUNTS.length - 1]
}

/**
 * Distribute available bits among BFUs using a greedy heap-based algorithm
 * Iteratively upgrades quantization precision for the BFU with highest SMR
 * @param {number} activeBfuCount - Number of BFUs to distribute bits to
 * @param {Float32Array} smrValues - Signal-to-Mask ratios for prioritization
 * @param {Array} bfuSizes - Size (coefficient count) of each BFU
 * @param {number} remainingBits - Total bits available for distribution
 * @returns {Int32Array} Word length index allocation per BFU
 */
function distributeBitsGreedy(
  activeBfuCount,
  smrValues,
  bfuSizes,
  remainingBits
) {
  const wordLengthAllocation = new Int32Array(activeBfuCount)
  const heapBfuIndices = []
  const heapPriorities = []

  // Initialize heap with BFUs that have finite SMR values
  for (let bfuIndex = 0; bfuIndex < activeBfuCount; bfuIndex++) {
    if (smrValues[bfuIndex] > -Infinity) {
      heapBfuIndices.push(bfuIndex)
      heapPriorities.push(smrValues[bfuIndex])
    }
  }

  // Build max-heap structure
  for (
    let nodeIndex = (heapBfuIndices.length >> 1) - 1;
    nodeIndex >= 0;
    nodeIndex--
  ) {
    siftDown(heapBfuIndices, heapPriorities, nodeIndex)
  }

  // Greedily allocate bits to highest priority BFUs
  while (heapBfuIndices.length && remainingBits > 0) {
    const currentBfu = heapBfuIndices[0]
    const currentWordLength = wordLengthAllocation[currentBfu]

    // Skip BFUs that have reached maximum quantization precision
    if (currentWordLength >= MAX_WORD_LENGTH_INDEX) {
      popRoot(heapBfuIndices, heapPriorities)
      continue
    }

    // Calculate bit cost for upgrading this BFU's quantization
    const bfuSize = bfuSizes[currentBfu]
    const upgradeCost =
      WORD_LENGTH_BITS[currentWordLength + 1] * bfuSize -
      WORD_LENGTH_BITS[currentWordLength] * bfuSize

    if (upgradeCost > remainingBits) {
      popRoot(heapBfuIndices, heapPriorities)
      continue
    }

    // Perform the upgrade
    remainingBits -= upgradeCost
    wordLengthAllocation[currentBfu] = currentWordLength + 1
    heapPriorities[0] += DISTORTION_DELTA_DB[currentWordLength]
    siftDown(heapBfuIndices, heapPriorities, 0)
  }

  return wordLengthAllocation
}

/**
 * Remove the root element from a max-heap and restore heap property
 * @param {Array} heapIndices - Array of BFU indices forming the heap
 * @param {Array} heapPriorities - Array of priority values corresponding to indices
 */
function popRoot(heapIndices, heapPriorities) {
  const lastIndex = heapIndices.length - 1
  heapIndices[0] = heapIndices[lastIndex]
  heapPriorities[0] = heapPriorities[lastIndex]
  heapIndices.pop()
  heapPriorities.pop()
  if (heapIndices.length) siftDown(heapIndices, heapPriorities, 0)
}

/**
 * Restore max-heap property by sifting an element down to its correct position
 * @param {Array} heapIndices - Array of BFU indices forming the heap
 * @param {Array} heapPriorities - Array of priority values corresponding to indices
 * @param {number} startIndex - Index of element to sift down
 */
function siftDown(heapIndices, heapPriorities, startIndex) {
  const heapSize = heapIndices.length
  let currentIndex = startIndex
  const originalIndexValue = heapIndices[currentIndex]
  const originalPriorityValue = heapPriorities[currentIndex]

  while (true) {
    const leftChildIndex = (currentIndex << 1) + 1
    const rightChildIndex = leftChildIndex + 1
    let maxIndex = currentIndex
    let maxPriority = originalPriorityValue

    // Check if left child has higher priority
    if (
      leftChildIndex < heapSize &&
      heapPriorities[leftChildIndex] > maxPriority
    ) {
      maxIndex = leftChildIndex
      maxPriority = heapPriorities[leftChildIndex]
    }

    // Check if right child has higher priority
    if (
      rightChildIndex < heapSize &&
      heapPriorities[rightChildIndex] > maxPriority
    ) {
      maxIndex = rightChildIndex
    }

    // If current position is correct, we're done
    if (maxIndex === currentIndex) break

    // Move the higher priority child up
    heapIndices[currentIndex] = heapIndices[maxIndex]
    heapPriorities[currentIndex] = heapPriorities[maxIndex]
    currentIndex = maxIndex
  }

  // Place original element in its final position
  heapIndices[currentIndex] = originalIndexValue
  heapPriorities[currentIndex] = originalPriorityValue
}
