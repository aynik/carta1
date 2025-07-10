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
  PSYMODEL_NON_TONAL,
  PSYMODEL_IRRELEVANT,
  PSYMODEL_LOG10_FACTOR,
  PSYMODEL_POW10_FACTOR,
  PSYMODEL_CRITICAL_BANDS,
  PSYMODEL_CB_FREQ_INDICES,
  PSYMODEL_THRESHOLD_TABLE,
  PSYMODEL_FREQ_TO_CB_MAP,
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
 * @param {number} targetSize - Target FFT size for analysis
 * @param {Object} psychoBuffers - Reusable buffers for performance
 * @returns {Object} Analysis results including PSD, maskers, and thresholds
 */
export function psychoAnalysis(
  mdctCoeffs,
  targetSize,
  psychoBuffers,
  normalizationDb
) {
  const fftScale = targetSize / 512

  // Apply frequency band reversal correction
  const correctedCoeffs = applyMdctCorrection(mdctCoeffs)

  // Calculate power spectral density
  const psd = calculatePSDFromMDCT(correctedCoeffs, targetSize, normalizationDb)

  // Find tonal and non-tonal maskers
  const { flags, tonalMaskers, nonTonalMaskers } = findAllMaskers(
    psd,
    psychoBuffers,
    fftScale
  )

  // Calculate global masking threshold
  const globalThreshold = calculateGlobalThreshold(
    psd,
    tonalMaskers,
    nonTonalMaskers,
    psychoBuffers.threshold,
    targetSize
  )

  return {
    psd,
    tonalMaskers,
    nonTonalMaskers,
    globalThreshold,
    flags,
  }
}

/**
 * Apply frequency band reversal correction to MDCT coefficients
 * @param {Float32Array} mdctCoeffs - Original MDCT coefficients
 * @returns {Float32Array} Corrected coefficients
 */
function applyMdctCorrection(mdctCoeffs) {
  const corrected = new Float32Array(512)

  // Low band: direct copy
  corrected.set(mdctCoeffs.subarray(0, 128), 0)

  // Mid band: reversed
  for (let i = 0; i < 128; i++) {
    corrected[128 + i] = mdctCoeffs[255 - i]
  }

  // High band: reversed
  for (let i = 0; i < 256; i++) {
    corrected[256 + i] = mdctCoeffs[511 - i]
  }

  return corrected
}

/**
 * Calculate Power Spectral Density from MDCT coefficients
 * @param {Float32Array} mdctCoeffs - MDCT coefficients
 * @param {number} targetSize - Target FFT size
 * @returns {Float32Array} Power spectral density in dB
 */
function calculatePSDFromMDCT(mdctCoeffs, targetSize, normalizationDb) {
  const halfTargetSize = targetSize / 2
  const psd = new Float32Array(halfTargetSize + 1)

  // Calculate power values and find maximum
  const powers = new Float32Array(512)
  let maxPower = 0

  for (let i = 0; i < 512; i++) {
    const power = mdctCoeffs[i] * mdctCoeffs[i]
    powers[i] = power
    maxPower = Math.max(maxPower, power)
  }

  const normFactor = 1 / (maxPower || 1)
  let maxPsdValue = -Infinity

  if (targetSize === 512) {
    // Direct averaging for same size
    for (let i = 0; i < 256; i++) {
      const avgPower = (powers[i * 2] + powers[i * 2 + 1]) * 0.5 * normFactor
      psd[i] = avgPower > 0 ? toDb(avgPower) : PSYMODEL_MIN_POWER_DB
      maxPsdValue = Math.max(maxPsdValue, psd[i])
    }
    psd[256] = psd[255]
    // Check if last value is the max
    maxPsdValue = Math.max(maxPsdValue, psd[256])
  } else {
    // Interpolate for different sizes
    const scaleFactor = 512 / targetSize

    for (let i = 0; i <= halfTargetSize; i++) {
      const srcIdx = i * scaleFactor
      const srcIdxInt = Math.floor(srcIdx)
      const frac = srcIdx - srcIdxInt

      const power =
        srcIdxInt < 511
          ? powers[srcIdxInt] * (1 - frac) + powers[srcIdxInt + 1] * frac
          : powers[511]

      const normalizedPower = power * normFactor
      psd[i] =
        normalizedPower > 0 ? toDb(normalizedPower) : PSYMODEL_MIN_POWER_DB

      maxPsdValue = Math.max(maxPsdValue, psd[i])
    }
  }

  // Apply normalization to target maximum
  const normalizationDelta = normalizationDb - maxPsdValue

  for (let i = 0; i < psd.length; i++) {
    if (psd[i] > PSYMODEL_MIN_POWER_DB) {
      psd[i] += normalizationDelta
    }
  }

  return psd
}

/**
 * Find all maskers (tonal and non-tonal) in the spectrum
 * @param {Float32Array} psd - Power spectral density
 * @param {Object} psychoBuffers - Reusable buffers
 * @param {number} fftScale - FFT scaling factor
 * @returns {Object} Flags array and lists of maskers
 */
function findAllMaskers(psd, psychoBuffers, fftScale) {
  // Initialize flags
  const flags = psychoBuffers.flags
  flags.fill(PSYMODEL_NOT_EXAMINED)

  // Find tonal maskers first
  let { tonalList } = findTonalMaskers(psd, flags, fftScale)

  // Find non-tonal maskers
  let { nonTonalList } = findNonTonalMaskers(flags, psd)

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
  const fftSize = (psd.length - 1) * 2

  // Frequency range boundaries
  const RANGE_LOW = Math.floor(63 * fftScale)
  const RANGE_MID = Math.floor(127 * fftScale)
  const RANGE_HIGH = Math.floor(150 * fftScale)

  for (let k = 1; k < fftSize / 2 - 1 && k <= maxTonalBin; k++) {
    // Check for local maximum
    if (psd[k] <= psd[k - 1] || psd[k] < psd[k + 1]) continue

    // Determine search range based on frequency
    const searchOffsets = getSearchOffsets(k, RANGE_LOW, RANGE_MID, RANGE_HIGH)
    if (!searchOffsets) continue

    // Check tonality criteria
    if (isTonal(psd, k, searchOffsets)) {
      // Calculate combined SPL
      const spl = toDb(fromDb(psd[k - 1]) + fromDb(psd[k]) + fromDb(psd[k + 1]))

      tonalList.push({ index: k, spl })
      markTonalComponent(flags, k, searchOffsets)
    }
  }

  return { flags, tonalList }
}

/**
 * Get search offsets for tonality check based on frequency
 */
function getSearchOffsets(k, rangeLow, rangeMid, rangeHigh) {
  if (k > 2 && k < rangeLow) return [-2, 2]
  if (k >= rangeLow && k < rangeMid) return [-3, -2, 2, 3]
  if (k >= rangeMid && k < rangeHigh) return [-6, -5, -4, -3, -2, 2, 3, 4, 5, 6]
  return null
}

/**
 * Check if a peak is tonal based on surrounding bins
 */
function isTonal(psd, k, offsets) {
  const TONAL_THRESHOLD = 7 // dB

  for (const offset of offsets) {
    const idx = k + offset
    if (idx >= 0 && idx < psd.length) {
      if (psd[k] - psd[idx] < TONAL_THRESHOLD) return false
    }
  }

  return true
}

/**
 * Mark component and neighbors as tonal/irrelevant
 */
function markTonalComponent(flags, k, searchOffsets) {
  flags[k] = PSYMODEL_TONAL

  const allOffsets = [...searchOffsets, -1, 1]
  for (const offset of allOffsets) {
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

    // Calculate band energy and centroid
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

  return { flags, nonTonalList }
}

/**
 * Analyze a critical band for non-tonal masking
 */
function analyzeCriticalBand(psd, flags, startBin, endBin, bandIndex) {
  let totalPower = 0
  let weightedPower = 0
  const baseBark = PSYMODEL_THRESHOLD_TABLE[bandIndex][1]

  for (let k = startBin; k < endBin && k < flags.length; k++) {
    if (flags[k] === PSYMODEL_NOT_EXAMINED) {
      const power = fromDb(psd[k])
      totalPower += power

      const barkDiff =
        PSYMODEL_THRESHOLD_TABLE[PSYMODEL_FREQ_TO_CB_MAP[k]][1] - baseBark
      weightedPower += power * barkDiff

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
 * Calculate global masking threshold
 * @param {Float32Array} psd - Power spectral density
 * @param {Array} tonalMaskers - List of tonal maskers
 * @param {Array} nonTonalMaskers - List of non-tonal maskers
 * @param {Float32Array} thresholdBuffer - Output buffer for threshold
 * @param {number} fftSize - FFT size
 * @returns {Float32Array} Global masking threshold
 */
function calculateGlobalThreshold(
  psd,
  tonalMaskers,
  nonTonalMaskers,
  thresholdBuffer,
  fftSize
) {
  const criticalBandThresholds = new Float32Array(
    PSYMODEL_CRITICAL_BANDS.length
  )

  // Calculate threshold for each critical band
  calculateCriticalBandThresholds(
    psd,
    tonalMaskers,
    nonTonalMaskers,
    criticalBandThresholds
  )

  // Interpolate to full spectrum with compensation
  interpolateThresholdCompensated(
    criticalBandThresholds,
    thresholdBuffer,
    fftSize
  )

  return thresholdBuffer
}

/**
 * Calculate masking threshold for each critical band
 */
function calculateCriticalBandThresholds(
  psd,
  tonalMaskers,
  nonTonalMaskers,
  output
) {
  for (let i = 0; i < PSYMODEL_CRITICAL_BANDS.length; i++) {
    const bandData = PSYMODEL_THRESHOLD_TABLE[PSYMODEL_CRITICAL_BANDS[i]]
    const maskedBark = bandData[1]
    const quietThreshold = bandData[2]

    // Start with threshold in quiet
    let summedEnergy = fromDb(quietThreshold)

    // Add contributions from all maskers
    summedEnergy += calculateMaskerContributions(
      psd,
      tonalMaskers,
      maskedBark,
      true // isTonal
    )

    summedEnergy += calculateMaskerContributions(
      psd,
      nonTonalMaskers,
      maskedBark,
      false // isTonal
    )

    output[i] = toDb(summedEnergy)
  }
}

/**
 * Calculate energy contributions from a set of maskers
 */
function calculateMaskerContributions(psd, maskers, maskedBark, isTonal) {
  let totalEnergy = 0

  for (const masker of maskers) {
    const j = masker.index
    if (j >= PSYMODEL_FREQ_TO_CB_MAP.length) continue

    const maskerBark = PSYMODEL_THRESHOLD_TABLE[PSYMODEL_FREQ_TO_CB_MAP[j]][1]
    const barkDistance = maskedBark - maskerBark

    // Check if within masking range
    if (barkDistance < -3 || barkDistance >= 8) continue

    // Calculate masking level
    const maskedDb = calculateMaskingLevel(
      masker.spl,
      psd[j],
      maskerBark,
      barkDistance,
      isTonal
    )

    totalEnergy += fromDb(maskedDb)
  }

  return totalEnergy
}

/**
 * Calculate masking level based on masker properties
 */
function calculateMaskingLevel(
  maskerSpl,
  maskerPsd,
  maskerBark,
  barkDistance,
  isTonal
) {
  // Masking index
  const tonalOffset = isTonal
    ? -1.525 - 0.275 * maskerBark - 4.5
    : -1.525 - 0.175 * maskerBark - 0.5

  // PSD-dependent factors
  const psdFactor1 = 0.4 * maskerPsd + 6
  const psdFactor2 = 0.15 * maskerPsd

  // Calculate masking function
  let maskingFunction
  if (barkDistance < -1) {
    maskingFunction = 17 * (barkDistance + 1) - psdFactor1
  } else if (barkDistance < 0) {
    maskingFunction = psdFactor1 * barkDistance
  } else if (barkDistance < 1) {
    maskingFunction = -17 * barkDistance
  } else {
    maskingFunction = -(barkDistance - 1) * (17 - psdFactor2) - 17
  }

  return maskerSpl + tonalOffset + maskingFunction
}

/**
 * Interpolate critical band thresholds to full spectrum
 * @param {Float32Array} cbThresholds - Critical band thresholds
 * @param {Float32Array} output - Output buffer
 * @param {number} fftSize - FFT size
 */
function interpolateThresholdCompensated(cbThresholds, output, fftSize) {
  const COMPENSATION_FACTOR = 0.25
  const halfSize = fftSize / 2

  // Get frequency indices for critical bands
  const freqIndices = PSYMODEL_CB_FREQ_INDICES

  let bandIndex = 0
  for (let i = 0; i <= halfSize; i++) {
    if (i <= freqIndices[0]) {
      // Before first critical band
      output[i] = cbThresholds[0]
    } else if (i >= freqIndices[freqIndices.length - 1]) {
      // After last critical band
      output[i] = cbThresholds[cbThresholds.length - 1]
    } else {
      // Find current band
      while (
        bandIndex < freqIndices.length - 1 &&
        freqIndices[bandIndex + 1] < i
      ) {
        bandIndex++
      }

      // Interpolate with compensation
      const x0 = freqIndices[bandIndex]
      const x1 = freqIndices[bandIndex + 1]
      const y0 = cbThresholds[bandIndex]
      const y1 = cbThresholds[bandIndex + 1]
      const bandWidth = x1 - x0

      if (bandWidth > 0) {
        const t = (i - x0) / bandWidth
        const interpolated = y0 + (y1 - y0) * t
        const compensation = Math.abs(y1 - y0) * COMPENSATION_FACTOR
        output[i] = interpolated + compensation
      } else {
        output[i] = y0
      }
    }
  }
}
