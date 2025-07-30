/**
 * Carta1 Audio Codec - MDCT-based Psychoacoustic Analysis
 *
 * This module implements the psychoacoustic model for ATRAC1 compression,
 * analyzing audio signals to determine masking thresholds for perceptual coding.
 */

import {
  PSYMODEL_MIN_POWER_DB,
  PSYMODEL_NOT_EXAMINED,
  PSYMODEL_TONAL,
  PSYMODEL_FFT_SIZE,
  PSYMODEL_NON_TONAL,
  PSYMODEL_IRRELEVANT,
  PSYMODEL_LOG10_FACTOR,
  PSYMODEL_POW10_FACTOR,
  PSYMODEL_CRITICAL_BANDS,
  PSYMODEL_THRESHOLD_TABLE,
  PSYMODEL_FREQ_TO_CB_MAP,
  PSYMODEL_PSD_SOURCE_IDX0,
  PSYMODEL_PSD_INTERP_WEIGHT,
  PSYMODEL_PSD_SOURCE_IDX1,
} from '../core/constants.js'

/**
 * Convert linear power value to decibels
 * @param {number} value - Linear power value
 * @returns {number} Power in decibels
 */
export function toDb(value) {
  return value > 0
    ? PSYMODEL_LOG10_FACTOR * Math.log(value)
    : PSYMODEL_MIN_POWER_DB
}

/**
 * Convert decibels to linear power value
 * @param {number} db - Power in decibels
 * @returns {number} Linear power value
 */
export function fromDb(db) {
  return Math.exp(db * PSYMODEL_POW10_FACTOR)
}

/**
 * Perform complete psychoacoustic analysis on MDCT coefficients
 * @param {Float32Array} mdctCoeffs - MDCT coefficients (512 samples)
 * @param {number} normalizationDb - Target maximum power level in dB
 * @returns {Object} Analysis results including PSD, maskers, and thresholds
 */
export function psychoAnalysis(mdctCoeffs, normalizationDb) {
  const fftScale = PSYMODEL_FFT_SIZE / 512

  // Calculate power spectral density
  const psd = calculatePSDFromMDCT(mdctCoeffs, normalizationDb)

  // Find tonal and non-tonal maskers
  const { flags, tonalMaskers, nonTonalMaskers } = findAllMaskers(psd, fftScale)

  // Calculate critical band masking thresholds
  const criticalBandThresholds = calculateCriticalBandThresholds(
    psd,
    tonalMaskers,
    nonTonalMaskers
  )

  return {
    psd,
    tonalMaskers,
    tonalMaskersCount: tonalMaskers.length,
    nonTonalMaskers,
    nonTonalMaskersCount: nonTonalMaskers.length,
    criticalBandThresholds,
    flags,
  }
}

/**
 * Calculate Power Spectral Density from MDCT coefficients
 * @param {Float32Array} mdctCoeffs - MDCT coefficients
 * @returns {Float32Array} Power spectral density in dB
 */
function calculatePSDFromMDCT(mdctCoeffs, normalizationDb) {
  const half = PSYMODEL_FFT_SIZE >>> 1
  const psd = new Float32Array(half + 1)
  const linearPower = new Float32Array(half + 1)

  let maxLinearPower = 0
  for (let i = 0; i <= half; i++) {
    const a = mdctCoeffs[PSYMODEL_PSD_SOURCE_IDX0[i]]
    const b = mdctCoeffs[PSYMODEL_PSD_SOURCE_IDX1[i]]

    const power =
      a * a * (1 - PSYMODEL_PSD_INTERP_WEIGHT[i]) +
      b * b * PSYMODEL_PSD_INTERP_WEIGHT[i]
    linearPower[i] = power

    if (power > maxLinearPower) {
      maxLinearPower = power
    }
  }

  const offset =
    normalizationDb - PSYMODEL_LOG10_FACTOR * Math.log(maxLinearPower || 1)

  for (let i = 0; i <= half; i++) {
    const power = linearPower[i]
    if (power > 0) {
      psd[i] = PSYMODEL_LOG10_FACTOR * Math.log(power) + offset
    } else {
      psd[i] = PSYMODEL_MIN_POWER_DB
    }
  }

  return psd
}

/**
 * Find all maskers (tonal and non-tonal) in the spectrum
 * @param {Float32Array} psd - Power spectral density
 * @param {number} fftScale - FFT scaling factor
 * @returns {Object} Flags array and lists of maskers
 */
function findAllMaskers(psd, fftScale) {
  // Initialize flags
  const flags = new Uint8Array(PSYMODEL_FFT_SIZE / 2)
  flags.fill(PSYMODEL_NOT_EXAMINED)

  // Find tonal maskers first
  const tonalList = findTonalMaskers(psd, flags, fftScale)

  // Find non-tonal maskers
  const nonTonalList = findNonTonalMaskers(flags, psd)

  // Apply decimation to remove weak maskers
  const decimated = decimateMaskers(flags, tonalList, nonTonalList)

  return {
    flags,
    tonalMaskers: decimated.tonalList,
    nonTonalMaskers: decimated.nonTonalList,
  }
}

/**
 * Detect tonal maskers (peaks in spectrum)
 * @param {Float32Array} psd - Power spectral density
 * @param {Uint8Array} flags - Component classification flags
 * @param {number} fftScale - FFT scaling factor
 * @returns {Object} Updated flags and tonal masker list
 */
function findTonalMaskers(psd, flags, fftScale) {
  const tonalList = []
  const maxTonalBin = Math.floor(249 * fftScale)

  // Frequency range boundaries
  const RANGE_LOW = Math.floor(63 * fftScale)
  const RANGE_MID = Math.floor(127 * fftScale)
  const RANGE_HIGH = Math.floor(150 * fftScale)

  for (let k = 1; k < psd.length - 1 && k <= maxTonalBin; k++) {
    // Check for local maximum
    if (psd[k] <= psd[k - 1] || psd[k] < psd[k + 1]) continue

    // Determine search range based on frequency
    let searchOffsets
    if (k > 2 && k < RANGE_LOW) {
      searchOffsets = [-2, 2]
    } else if (k >= RANGE_LOW && k < RANGE_MID) {
      searchOffsets = [-3, -2, 2, 3]
    } else if (k >= RANGE_MID && k < RANGE_HIGH) {
      searchOffsets = [-6, -5, -4, -3, -2, 2, 3, 4, 5, 6]
    } else {
      continue
    }

    // Check tonality criteria
    if (isTonal(psd, k, searchOffsets)) {
      // Calculate combined SPL
      const spl = toDb(fromDb(psd[k - 1]) + fromDb(psd[k]) + fromDb(psd[k + 1]))
      tonalList.push({ index: k, spl })
      markTonalComponent(flags, k, searchOffsets)
    }
  }

  return tonalList
}

/**
 * Check if a peak is tonal based on surrounding bins
 * @param {Float32Array} psd - Power spectral density array
 * @param {number} k - Index of the peak to test
 * @param {number[]} offsets - Array of offset indices to check around the peak
 * @returns {boolean} True if the peak qualifies as tonal
 */
function isTonal(psd, k, offsets) {
  const TONAL_THRESHOLD = 7.0
  for (const offset of offsets) {
    const idx = k + offset
    if (idx >= 0 && idx < psd.length && psd[k] - psd[idx] < TONAL_THRESHOLD) {
      return false
    }
  }
  return true
}

/**
 * Mark component and neighbors as tonal/irrelevant
 * @param {Uint8Array} flags - Component classification flags array
 * @param {number} k - Index of the tonal component
 * @param {number[]} searchOffsets - Array of offset indices used for tonal detection
 */
function markTonalComponent(flags, k, searchOffsets) {
  flags[k] = PSYMODEL_TONAL
  for (const offset of [...searchOffsets, -1, 1]) {
    const idx = k + offset
    if (idx >= 0 && idx < flags.length && idx !== k) {
      flags[idx] = PSYMODEL_IRRELEVANT
    }
  }
}

/**
 * Detect non-tonal maskers (noise-like components)
 * @param {Uint8Array} flags - Component classification flags
 * @param {Float32Array} psd - Power spectral density
 * @returns {Object} Updated flags and non-tonal masker list
 */
function findNonTonalMaskers(flags, psd) {
  const nonTonalList = []

  for (let i = 0; i < PSYMODEL_CRITICAL_BANDS.length - 1; i++) {
    const cbStart = PSYMODEL_THRESHOLD_TABLE[PSYMODEL_CRITICAL_BANDS[i]][0] - 1
    const cbEnd =
      PSYMODEL_THRESHOLD_TABLE[PSYMODEL_CRITICAL_BANDS[i + 1]][0] - 1

    const bandAnalysis = analyzeCriticalBand(
      psd,
      flags,
      cbStart,
      cbEnd,
      PSYMODEL_CRITICAL_BANDS[i]
    )

    if (bandAnalysis.powerDb > PSYMODEL_MIN_POWER_DB) {
      // Place masker at energy centroid
      let index = Math.round(cbStart + bandAnalysis.centroidOffset)
      index = Math.max(0, Math.min(index, flags.length - 1))

      // Avoid conflict with tonal maskers
      if (flags[index] === PSYMODEL_TONAL) {
        index = Math.min(index + 1, flags.length - 1)
      }

      nonTonalList.push({ index, spl: bandAnalysis.powerDb })
      flags[index] = PSYMODEL_NON_TONAL
    }
  }

  return nonTonalList
}

/**
 * Analyze a critical band for non-tonal masking
 * @param {Float32Array} psd - Power spectral density array
 * @param {Uint8Array} flags - Component classification flags array
 * @param {number} startBin - Starting frequency bin of the critical band
 * @param {number} endBin - Ending frequency bin of the critical band
 * @param {number} bandIndex - Critical band index for threshold table lookup
 * @returns {Object} Analysis results with power and centroid offset
 */
function analyzeCriticalBand(psd, flags, startBin, endBin, bandIndex) {
  let totalPower = 0
  let weightedPower = 0
  const baseBark = PSYMODEL_THRESHOLD_TABLE[bandIndex][1]

  for (let k = startBin; k < endBin && k < flags.length; k++) {
    if (flags[k] === PSYMODEL_NOT_EXAMINED) {
      const power = fromDb(psd[k])
      totalPower += power

      if (k < PSYMODEL_FREQ_TO_CB_MAP.length) {
        const barkDiff =
          PSYMODEL_THRESHOLD_TABLE[PSYMODEL_FREQ_TO_CB_MAP[k]][1] - baseBark
        weightedPower += power * barkDiff
      }

      flags[k] = PSYMODEL_IRRELEVANT
    }
  }

  return {
    powerDb: toDb(totalPower),
    centroidOffset:
      totalPower > 0 ? (weightedPower / totalPower) * (endBin - startBin) : 0,
  }
}

/**
 * Remove weak maskers below absolute threshold
 * @param {Uint8Array} flags - Component classification flags
 * @param {Array} tonalList - List of tonal maskers
 * @param {Array} nonTonalList - List of non-tonal maskers
 * @returns {Object} Filtered masker lists
 */
function decimateMaskers(flags, tonalList, nonTonalList) {
  const isAudible = (masker) => {
    const k = masker.index
    return (
      k < PSYMODEL_FREQ_TO_CB_MAP.length &&
      masker.spl >= PSYMODEL_THRESHOLD_TABLE[PSYMODEL_FREQ_TO_CB_MAP[k]][2]
    )
  }

  const markInaudible = (masker) => {
    if (masker.index < flags.length) {
      flags[masker.index] = PSYMODEL_IRRELEVANT
    }
  }

  // Filter tonal maskers
  const audibleTonal = []
  for (const tonal of tonalList) {
    if (isAudible(tonal)) {
      audibleTonal.push(tonal)
    } else {
      markInaudible(tonal)
    }
  }

  // Filter non-tonal maskers
  const audibleNonTonal = []
  for (const nonTonal of nonTonalList) {
    if (isAudible(nonTonal)) {
      audibleNonTonal.push(nonTonal)
    } else {
      markInaudible(nonTonal)
    }
  }

  return {
    tonalList: audibleTonal,
    nonTonalList: audibleNonTonal,
  }
}

/**
 * Calculate critical band masking thresholds
 * @param {Float32Array} psd - Power spectral density
 * @param {Array} tonalMaskers - List of tonal maskers
 * @param {Array} nonTonalMaskers - List of non-tonal maskers
 * @returns {Float32Array} Critical band thresholds
 */
function calculateCriticalBandThresholds(psd, tonalMaskers, nonTonalMaskers) {
  const criticalBandThresholds = new Float32Array(
    PSYMODEL_CRITICAL_BANDS.length
  )

  // Pre-collect all maskers with their properties
  const maskers = []

  for (const masker of tonalMaskers) {
    const j = masker.index
    if (j < PSYMODEL_FREQ_TO_CB_MAP.length) {
      maskers.push({
        spl: masker.spl,
        psd: psd[j],
        bark: PSYMODEL_THRESHOLD_TABLE[PSYMODEL_FREQ_TO_CB_MAP[j]][1],
        isTonal: true,
      })
    }
  }

  for (const masker of nonTonalMaskers) {
    const j = masker.index
    if (j < PSYMODEL_FREQ_TO_CB_MAP.length) {
      maskers.push({
        spl: masker.spl,
        psd: psd[j],
        bark: PSYMODEL_THRESHOLD_TABLE[PSYMODEL_FREQ_TO_CB_MAP[j]][1],
        isTonal: false,
      })
    }
  }

  // Calculate threshold for each critical band
  for (let i = 0; i < PSYMODEL_CRITICAL_BANDS.length; i++) {
    const bandData = PSYMODEL_THRESHOLD_TABLE[PSYMODEL_CRITICAL_BANDS[i]]
    const maskedBark = bandData[1]
    const quietThreshold = bandData[2]

    // Start with threshold in quiet
    let summedEnergy = fromDb(quietThreshold)

    // Add contributions from all maskers
    for (const masker of maskers) {
      const barkDistance = maskedBark - masker.bark

      // Check if within masking range
      if (barkDistance >= -3 && barkDistance < 8) {
        const maskedDb = calculateMaskingLevel(
          masker.spl,
          masker.psd,
          masker.bark,
          barkDistance,
          masker.isTonal
        )
        summedEnergy += fromDb(maskedDb)
      }
    }

    criticalBandThresholds[i] = toDb(summedEnergy)
  }

  return criticalBandThresholds
}

/**
 * Calculate energy contributions from a set of maskers
 * @param {number} maskerSpl - Sound pressure level of the masker in dB
 * @param {number} maskerPsd - Power spectral density of the masker in dB
 * @param {number} maskerBark - Bark frequency of the masker
 * @param {number} barkDistance - Distance in Bark scale from masker to maskee
 * @param {boolean} isTonal - Whether the masker is tonal or non-tonal
 * @returns {number} Masking threshold contribution in dB
 */
function calculateMaskingLevel(
  maskerSpl,
  maskerPsd,
  maskerBark,
  barkDistance,
  isTonal
) {
  const tonalOffset = isTonal
    ? -1.525 - 0.275 * maskerBark - 4.5
    : -1.525 - 0.175 * maskerBark - 0.5

  const psdFactor1 = 0.4 * maskerPsd + 6.0
  const psdFactor2 = 0.15 * maskerPsd

  let maskingFunction
  if (barkDistance < -1.0) {
    maskingFunction = 17.0 * (barkDistance + 1.0) - psdFactor1
  } else if (barkDistance < 0.0) {
    maskingFunction = psdFactor1 * barkDistance
  } else if (barkDistance < 1.0) {
    maskingFunction = -17.0 * barkDistance
  } else {
    maskingFunction = -(barkDistance - 1.0) * (17.0 - psdFactor2) - 17.0
  }

  return maskerSpl + tonalOffset + maskingFunction
}
