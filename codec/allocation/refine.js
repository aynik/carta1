/**
 * Carta1 waterfill tuning, Pareto perceptual bit exchange, and scale refinement.
 */

import {
  MAX_WORD_LENGTH_INDEX,
  MIN_SLACK_FILL_BITS,
  PARETO_EXCHANGE_PASSES,
  TUNE_BINARY_SEARCH_STEPS,
} from '../core/constants.js'
import { WORD_LENGTH_BITS } from '../core/tables.js'
import {
  getCachedBfuDistortion,
  measureBfuQuantizationError,
} from './distortion.js'

/**
 * Tune a global waterfill offset so integer word lengths fit the frame budget.
 *
 * @param {i32} candidateBfuCount
 * @param {i32} bitBudget
 * @param {Array<number>} bfuSizes
 * @param {Float64Array} energies
 * @param {Float64Array} seedThresholds
 * @param {Int32Array} candidateWordLengths
 * @returns {i32} Total coded sample bits used.
 * @nativeUnchecked Native callers supply frame-bounded buffers and indices.
 */
export function tuneToBudget(
  candidateBfuCount,
  bitBudget,
  bfuSizes,
  energies,
  seedThresholds,
  candidateWordLengths
) {
  /** @type {f64} */
  let minimumSeed = 1e9
  /** @type {f64} */
  let maximumSeed = -1e9
  let hasActive = 0

  for (let unit = 0; unit < candidateBfuCount; unit++) {
    const size = bfuSizes[unit] | 0
    if (energies[unit] > 0.0 && size > 0) {
      const seed = seedThresholds[unit]
      if (seed < minimumSeed) minimumSeed = seed
      if (seed > maximumSeed) maximumSeed = seed
      hasActive = 1
    }
  }

  if (hasActive === 0 || bitBudget <= 0) {
    for (let unit = 0; unit < candidateBfuCount; unit++) {
      candidateWordLengths[unit] = 0
    }
    return 0
  }

  /** @type {f64} */
  let lowerBound = minimumSeed - 16.0
  /** @type {f64} */
  let upperBound = maximumSeed + 2.0

  for (let step = 0; step < TUNE_BINARY_SEARCH_STEPS; step++) {
    const midpoint = 0.5 * (lowerBound + upperBound)
    let bits = 0
    for (let unit = 0; unit < candidateBfuCount; unit++) {
      const size = bfuSizes[unit] | 0
      if (energies[unit] <= 0.0 || size <= 0) continue
      const rawWordLength = Math.floor(seedThresholds[unit] - midpoint + 0.5)
      /** @type {i32} */
      let wordLength = 0
      if (rawWordLength >= MAX_WORD_LENGTH_INDEX) {
        wordLength = MAX_WORD_LENGTH_INDEX
      } else if (rawWordLength > 0.0) {
        wordLength = rawWordLength | 0
      }
      bits += WORD_LENGTH_BITS[wordLength] * size
    }
    if (bits <= bitBudget) {
      upperBound = midpoint
    } else {
      lowerBound = midpoint
    }
  }

  let usedBits = 0
  for (let unit = 0; unit < candidateBfuCount; unit++) {
    const size = bfuSizes[unit] | 0
    if (energies[unit] <= 0.0 || size <= 0) {
      candidateWordLengths[unit] = 0
      continue
    }
    const rawWordLength = Math.floor(seedThresholds[unit] - upperBound + 0.5)
    /** @type {i32} */
    let wordLength = 0
    if (rawWordLength >= MAX_WORD_LENGTH_INDEX) {
      wordLength = MAX_WORD_LENGTH_INDEX
    } else if (rawWordLength > 0.0) {
      wordLength = rawWordLength | 0
    }
    candidateWordLengths[unit] = wordLength
    usedBits += WORD_LENGTH_BITS[wordLength] * size
  }

  return usedBits
}

/**
 * Exchange bit steps from high-supply donors to perceptually under-allocated bands.
 *
 * @param {i32} candidateBfuCount
 * @param {i32} bitBudget
 * @param {i32} usedBits
 * @param {Array<Float32Array>} bfuData
 * @param {Array<number>} bfuSizes
 * @param {Int32Array} initialScaleFactorIndices
 * @param {Float64Array} maxAmplitudes
 * @param {Float64Array} energies
 * @param {Float64Array} perceptualWeights
 * @param {Float64Array} distortionCache
 * @param {Int32Array} candidateWordLengths
 * @returns {i32} Updated coded sample bits used.
 * @nativeUnchecked Native callers supply frame-bounded buffers and indices.
 */
export function exchangePerceptualBits(
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
) {
  for (let pass = 0; pass < PARETO_EXCHANGE_PASSES; pass++) {
    /** @type {i32} */
    let bestReceiver = -1
    let bestReceiverNextWordLength = 0
    let bestReceiverCost = 0
    /** @type {f64} */
    let bestReceiverBenefitPerBit = 0.0

    for (let unit = 0; unit < candidateBfuCount; unit++) {
      const size = bfuSizes[unit] | 0
      const wordLength = candidateWordLengths[unit]
      if (
        energies[unit] <= 0.0 ||
        size <= 0 ||
        wordLength >= MAX_WORD_LENGTH_INDEX
      )
        continue

      const weight = perceptualWeights[unit]
      /** @type {f64} */
      const currentDistortion = getCachedBfuDistortion(
        unit,
        wordLength,
        bfuData,
        bfuSizes,
        initialScaleFactorIndices,
        maxAmplitudes,
        distortionCache
      )
      /** @type {i32} */
      let maxJump = wordLength + 1
      if (wordLength === 0) {
        maxJump = 3
      }
      if (maxJump > MAX_WORD_LENGTH_INDEX) {
        maxJump = MAX_WORD_LENGTH_INDEX
      }

      for (
        let nextWordLength = wordLength + 1;
        nextWordLength <= maxJump;
        nextWordLength++
      ) {
        const cost =
          (WORD_LENGTH_BITS[nextWordLength] - WORD_LENGTH_BITS[wordLength]) *
          size
        if (cost <= 0 || cost > bitBudget) continue
        /** @type {f64} */
        const nextDistortion = getCachedBfuDistortion(
          unit,
          nextWordLength,
          bfuData,
          bfuSizes,
          initialScaleFactorIndices,
          maxAmplitudes,
          distortionCache
        )
        const gain = (currentDistortion - nextDistortion) * weight
        const benefitPerBit = gain / cost
        if (benefitPerBit > bestReceiverBenefitPerBit) {
          bestReceiverBenefitPerBit = benefitPerBit
          bestReceiver = unit
          bestReceiverNextWordLength = nextWordLength
          bestReceiverCost = cost
        }
      }
    }

    if (bestReceiver < 0) break

    if (usedBits + bestReceiverCost <= bitBudget) {
      candidateWordLengths[bestReceiver] = bestReceiverNextWordLength
      usedBits += bestReceiverCost
      continue
    }

    /** @type {i32} */
    let bestDonor = -1
    let bestDonorSaved = 0
    /** @type {f64} */
    let bestDonorDamagePerBit = 1e300

    for (let unit = 0; unit < candidateBfuCount; unit++) {
      if (unit === bestReceiver) continue
      const wordLength = candidateWordLengths[unit]
      const size = bfuSizes[unit] | 0
      if (wordLength <= 0 || size <= 0) continue

      const saved =
        (WORD_LENGTH_BITS[wordLength] - WORD_LENGTH_BITS[wordLength - 1]) * size
      if (saved <= 0 || usedBits - saved + bestReceiverCost > bitBudget)
        continue

      /** @type {f64} */
      const currentDistortion = getCachedBfuDistortion(
        unit,
        wordLength,
        bfuData,
        bfuSizes,
        initialScaleFactorIndices,
        maxAmplitudes,
        distortionCache
      )
      /** @type {f64} */
      const lowerDistortion = getCachedBfuDistortion(
        unit,
        wordLength - 1,
        bfuData,
        bfuSizes,
        initialScaleFactorIndices,
        maxAmplitudes,
        distortionCache
      )
      const loss =
        (lowerDistortion - currentDistortion) * perceptualWeights[unit]
      const damagePerBit = loss / saved
      if (damagePerBit < bestDonorDamagePerBit) {
        bestDonorDamagePerBit = damagePerBit
        bestDonor = unit
        bestDonorSaved = saved
      }
    }

    if (
      bestDonor >= 0 &&
      bestReceiverBenefitPerBit > bestDonorDamagePerBit * 1.02
    ) {
      candidateWordLengths[bestDonor] = candidateWordLengths[bestDonor] - 1
      candidateWordLengths[bestReceiver] = bestReceiverNextWordLength
      usedBits = usedBits - bestDonorSaved + bestReceiverCost
    } else {
      break
    }
  }

  return usedBits
}

/**
 * Spend remaining budget slack by highest perceptual distortion drop per bit.
 *
 * @param {i32} candidateBfuCount
 * @param {i32} remainingBits
 * @param {Array<Float32Array>} bfuData
 * @param {Array<number>} bfuSizes
 * @param {Int32Array} initialScaleFactorIndices
 * @param {Float64Array} maxAmplitudes
 * @param {Float64Array} energies
 * @param {Float64Array} perceptualWeights
 * @param {Float64Array} distortionCache
 * @param {Int32Array} candidateWordLengths
 * @returns {i32} Remaining unused bits.
 * @nativeUnchecked Native callers supply frame-bounded buffers and indices.
 */
export function fillSlackBits(
  candidateBfuCount,
  remainingBits,
  bfuData,
  bfuSizes,
  initialScaleFactorIndices,
  maxAmplitudes,
  energies,
  perceptualWeights,
  distortionCache,
  candidateWordLengths
) {
  while (remainingBits >= MIN_SLACK_FILL_BITS) {
    /** @type {i32} */
    let bestUnit = -1
    let bestNextWordLength = 0
    let bestCost = 0
    /** @type {f64} */
    let bestScore = 0.0

    for (let unit = 0; unit < candidateBfuCount; unit++) {
      const size = bfuSizes[unit] | 0
      const wordLength = candidateWordLengths[unit]
      if (
        energies[unit] <= 0.0 ||
        size <= 0 ||
        wordLength >= MAX_WORD_LENGTH_INDEX
      )
        continue

      /** @type {f64} */
      const currentDistortion = getCachedBfuDistortion(
        unit,
        wordLength,
        bfuData,
        bfuSizes,
        initialScaleFactorIndices,
        maxAmplitudes,
        distortionCache
      )
      const weight = perceptualWeights[unit]
      /** @type {i32} */
      let maxJump = wordLength + 1
      if (wordLength === 0) {
        maxJump = 3
      }
      if (maxJump > MAX_WORD_LENGTH_INDEX) {
        maxJump = MAX_WORD_LENGTH_INDEX
      }

      for (
        let nextWordLength = wordLength + 1;
        nextWordLength <= maxJump;
        nextWordLength++
      ) {
        const cost =
          (WORD_LENGTH_BITS[nextWordLength] - WORD_LENGTH_BITS[wordLength]) *
          size
        if (cost <= 0 || cost > remainingBits) continue

        /** @type {f64} */
        const nextDistortion = getCachedBfuDistortion(
          unit,
          nextWordLength,
          bfuData,
          bfuSizes,
          initialScaleFactorIndices,
          maxAmplitudes,
          distortionCache
        )
        const gain = (currentDistortion - nextDistortion) * weight
        if (gain > 0.0) {
          const score = gain / cost
          if (score > bestScore) {
            bestScore = score
            bestUnit = unit
            bestNextWordLength = nextWordLength
            bestCost = cost
          }
        }
      }
    }

    if (bestUnit < 0) break
    candidateWordLengths[bestUnit] = bestNextWordLength
    remainingBits -= bestCost
  }

  return remainingBits
}

/**
 * Verify whether lowering scale-factor index by 1 or 2 lowers reconstruction MSE.
 *
 * @param {i32} bestBfuCount
 * @param {i32} maxBfuCount
 * @param {Array<Float32Array>} bfuData
 * @param {Array<number>} bfuSizes
 * @param {Float64Array} energies
 * @param {Int32Array} initialScaleFactorIndices
 * @param {Int32Array} selectedWordLengths
 * @param {Int32Array} refinedScaleFactorIndices
 * @returns {void}
 * @nativeUnchecked Native callers supply frame-bounded buffers and indices.
 */
export function refineScaleFactors(
  bestBfuCount,
  maxBfuCount,
  bfuData,
  bfuSizes,
  energies,
  initialScaleFactorIndices,
  selectedWordLengths,
  refinedScaleFactorIndices
) {
  for (let unit = 0; unit < maxBfuCount; unit++) {
    refinedScaleFactorIndices[unit] = initialScaleFactorIndices[unit]
  }

  for (let unit = 0; unit < bestBfuCount; unit++) {
    const wordLength = selectedWordLengths[unit]
    const initialIndex = initialScaleFactorIndices[unit]
    const size = bfuSizes[unit] | 0
    if (
      wordLength <= 0 ||
      initialIndex <= 0 ||
      size <= 0 ||
      energies[unit] <= 0.0
    )
      continue

    /** @type {Float32Array} */
    const bfu = bfuData[unit]
    let bestIndex = initialIndex
    /** @type {f64} */
    let bestError = measureBfuQuantizationError(
      bfu,
      size,
      initialIndex,
      wordLength
    )
    /** @type {i32} */
    let minimumCandidate = 0
    if (initialIndex > 2) {
      minimumCandidate = initialIndex - 2
    }

    for (
      let candidate = minimumCandidate;
      candidate < initialIndex;
      candidate++
    ) {
      /** @type {f64} */
      const error = measureBfuQuantizationError(
        bfu,
        size,
        candidate,
        wordLength
      )
      if (error < bestError) {
        bestError = error
        bestIndex = candidate
      }
    }

    refinedScaleFactorIndices[unit] = bestIndex
  }
}
