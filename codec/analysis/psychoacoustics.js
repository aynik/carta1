/**
 * Carta1 Audio Codec - MDCT-based Psychoacoustic Analysis (Optimized)
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
  PSYMODEL_TONAL_OFFSETS_LOW_FREQ,
  PSYMODEL_TONAL_OFFSETS_MID_FREQ,
  PSYMODEL_TONAL_OFFSETS_HIGH_FREQ,
  PSYMODEL_HALF_FFT_SIZE,
  PSYMODEL_NUM_BINS,
} from '../core/constants.js'

/**
 * Convert linear power value to decibels
 * @param {number} value - Linear power value
 * @returns {number} Power in decibels, or minimum threshold if value <= 0
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
 *
 * This function implements the ISO/IEC 11172-3 psychoacoustic model to:
 * 1. Calculate power spectral density from MDCT coefficients
 * 2. Detect tonal and non-tonal maskers in the frequency domain
 * 3. Calculate critical band masking thresholds for bit allocation
 *
 * @param {Float32Array} mdctCoeffs - MDCT coefficients (512 samples)
 * @param {number} normalizationDb - Target maximum power level in dB for normalization
 * @param {Object} psychoBuffers - Psychoacoustics working buffers from buffer poool
 * @returns {Object} Analysis results with PSD, maskers, and critical band thresholds
 */
export function psychoAnalysis(mdctCoeffs, normalizationDb, psychoBuffers) {
  const fftScale = PSYMODEL_FFT_SIZE / 512

  // Create local index arrays
  const flags = new Int8Array(PSYMODEL_HALF_FFT_SIZE + 1)
  const tonalIdx = new Int32Array(PSYMODEL_HALF_FFT_SIZE)
  const nonTonalIdx = new Int32Array(PSYMODEL_CRITICAL_BANDS.length)
  const maskIsTonal = new Int8Array(PSYMODEL_HALF_FFT_SIZE)

  // Calculate PSD (dB), store raw linear power and normalization scale
  const { offsetDb } = calculatePSDFromMDCT(
    mdctCoeffs,
    normalizationDb,
    psychoBuffers
  )

  // Find tonal and non-tonal maskers
  const { tonalCount, nonTonalCount } = findAllMaskers(
    psychoBuffers,
    flags,
    tonalIdx,
    nonTonalIdx,
    offsetDb,
    fftScale
  )

  // Calculate critical band masking thresholds
  calculateCriticalBandThresholds(
    psychoBuffers,
    tonalIdx,
    nonTonalIdx,
    maskIsTonal,
    tonalCount,
    nonTonalCount
  )

  // Materialize objects only at the boundary (keep internal typed arrays)
  const tonalMaskers = new Array(tonalCount)
  for (let i = 0; i < tonalCount; i++) {
    tonalMaskers[i] = { index: tonalIdx[i], spl: psychoBuffers.tonalSPL[i] }
  }
  const nonTonalMaskers = new Array(nonTonalCount)
  for (let i = 0; i < nonTonalCount; i++) {
    nonTonalMaskers[i] = {
      index: nonTonalIdx[i],
      spl: psychoBuffers.nonTonalSPL[i],
    }
  }

  return {
    psd: psychoBuffers.psdDb,
    tonalMaskers,
    tonalMaskersCount: tonalCount,
    nonTonalMaskers,
    nonTonalMaskersCount: nonTonalCount,
    criticalBandThresholds: psychoBuffers.criticalBandThresholds,
    flags,
  }
}

/**
 * Calculate Power Spectral Density from MDCT coefficients
 *
 * Transforms MDCT coefficients to power spectral density using interpolation
 * between adjacent MDCT bins to match the psychoacoustic model's FFT resolution.
 * The output is normalized so the maximum power reaches the target level.
 *
 * @param {Float32Array} mdctCoeffs - Input MDCT coefficients (512 samples)
 * @param {number} normalizationDb - Target maximum power level in dB
 * @param {Object} psychoBuffers - Pre-allocated working buffers
 * @returns {Object} Normalization parameters {offsetDb, linScale}
 */
function calculatePSDFromMDCT(mdctCoeffs, normalizationDb, psychoBuffers) {
  const linPower = psychoBuffers.linPower

  let maxLinearPower = 0
  for (let i = 0; i <= PSYMODEL_HALF_FFT_SIZE; i++) {
    const a = mdctCoeffs[PSYMODEL_PSD_SOURCE_IDX0[i]]
    const b = mdctCoeffs[PSYMODEL_PSD_SOURCE_IDX1[i]]
    const w = PSYMODEL_PSD_INTERP_WEIGHT[i]

    // Calculate interpolated power between adjacent MDCT coefficients
    const interpolatedPower = a * a * (1 - w) + b * b * w
    linPower[i] = interpolatedPower
    if (interpolatedPower > maxLinearPower) maxLinearPower = interpolatedPower
  }

  // dB offset ensures max reaches normalizationDb
  const offsetDb =
    normalizationDb -
    (maxLinearPower > 0 ? PSYMODEL_LOG10_FACTOR * Math.log(maxLinearPower) : 0)

  // Calculate linear scale for later fast conversions
  const linScale = Math.exp(offsetDb * PSYMODEL_POW10_FACTOR)

  // Fill PSD in dB (normalized)
  const psdDb = psychoBuffers.psdDb
  if (maxLinearPower > 0) {
    for (let i = 0; i <= PSYMODEL_HALF_FFT_SIZE; i++) {
      const p = linPower[i]
      psdDb[i] =
        p > 0
          ? PSYMODEL_LOG10_FACTOR * Math.log(p) + offsetDb
          : PSYMODEL_MIN_POWER_DB
    }
  } else {
    psdDb.fill(PSYMODEL_MIN_POWER_DB, 0, PSYMODEL_NUM_BINS)
  }

  return { offsetDb, linScale }
}

/**
 * Orchestrate the complete masker detection process
 *
 * Coordinates the detection of both tonal and non-tonal maskers, then filters
 * out maskers that fall below the absolute hearing threshold.
 *
 * @param {Object} psychoBuffers - Pre-allocated working buffers
 * @param {Int8Array} flags - Classification flags for each frequency bin
 * @param {Int32Array} tonalIdx - Output array for tonal masker indices
 * @param {Int32Array} nonTonalIdx - Output array for non-tonal masker indices
 * @param {number} offsetDb - dB offset for power normalization
 * @param {number} fftScale - Scaling factor for FFT bin mapping
 * @returns {Object} Count of detected maskers after filtering
 */
function findAllMaskers(
  psychoBuffers,
  flags,
  tonalIdx,
  nonTonalIdx,
  offsetDb,
  fftScale
) {
  flags.fill(PSYMODEL_NOT_EXAMINED)

  const tonalCount = findTonalMaskers(
    psychoBuffers,
    flags,
    tonalIdx,
    offsetDb,
    fftScale
  )
  const nonTonalCount = findNonTonalMaskers(
    psychoBuffers,
    flags,
    nonTonalIdx,
    offsetDb
  )

  const { tonal: keptTonal, nonTonal: keptNonTonal } = decimateMaskers(
    psychoBuffers,
    flags,
    tonalIdx,
    nonTonalIdx,
    tonalCount,
    nonTonalCount
  )

  return {
    tonalCount: keptTonal,
    nonTonalCount: keptNonTonal,
  }
}

/**
 * Detect tonal maskers using linear power sums and a global dB offset
 *
 * Identifies frequency bins that represent tonal components by finding local peaks
 * that exceed neighboring bins by a sufficient margin. Uses different neighbor
 * patterns based on frequency range for optimal detection.
 *
 * @param {Object} psychoBuffers - Pre-allocated working buffers
 * @param {Int8Array} flags - Classification flags for each frequency bin
 * @param {Int32Array} tonalIdx - Output array for tonal masker indices
 * @param {number} offsetDb - dB offset for power normalization
 * @param {number} fftScale - Scaling factor for FFT bin mapping
 * @returns {number} Number of tonal maskers detected
 */
function findTonalMaskers(psychoBuffers, flags, tonalIdx, offsetDb, fftScale) {
  const psdDb = psychoBuffers.psdDb
  const linPower = psychoBuffers.linPower

  let count = 0
  const maxTonalBin = Math.floor(249 * fftScale)

  const RANGE_LOW = Math.floor(63 * fftScale)
  const RANGE_MID = Math.floor(127 * fftScale)
  const RANGE_HIGH = Math.floor(150 * fftScale)

  for (
    let binIndex = 1, len = psdDb.length - 1;
    binIndex < len && binIndex <= maxTonalBin;
    binIndex++
  ) {
    // Check for local peak in power spectral density
    const binPower = psdDb[binIndex]
    if (binPower <= psdDb[binIndex - 1] || binPower < psdDb[binIndex + 1])
      continue

    // Select neighbor pattern based on frequency range
    let neighborOffsets = null
    if (binIndex > 2 && binIndex < RANGE_LOW)
      neighborOffsets = PSYMODEL_TONAL_OFFSETS_LOW_FREQ
    else if (binIndex >= RANGE_LOW && binIndex < RANGE_MID)
      neighborOffsets = PSYMODEL_TONAL_OFFSETS_MID_FREQ
    else if (binIndex >= RANGE_MID && binIndex < RANGE_HIGH)
      neighborOffsets = PSYMODEL_TONAL_OFFSETS_HIGH_FREQ
    else continue

    if (isTonalWithOffsets(psdDb, binIndex, neighborOffsets)) {
      // Calculate SPL using adjacent bins: offsetDb + 10*log10(sum of linear powers)
      const adjacentPowerSum =
        linPower[binIndex - 1] + linPower[binIndex] + linPower[binIndex + 1]
      const soundPressureLevel =
        adjacentPowerSum > 0
          ? offsetDb + PSYMODEL_LOG10_FACTOR * Math.log(adjacentPowerSum)
          : PSYMODEL_MIN_POWER_DB

      tonalIdx[count] = binIndex
      psychoBuffers.tonalSPL[count] = soundPressureLevel
      count++

      // Mark this bin as tonal and mark neighbors as irrelevant
      flags[binIndex] = PSYMODEL_TONAL

      // Mark pattern-specific neighbors as irrelevant
      for (let i = 0; i < neighborOffsets.length; i++) {
        const neighborIdx = binIndex + neighborOffsets[i]
        if (
          neighborIdx >= 0 &&
          neighborIdx < flags.length &&
          neighborIdx !== binIndex
        ) {
          flags[neighborIdx] = PSYMODEL_IRRELEVANT
        }
      }

      // Mark immediate neighbors as irrelevant
      if (binIndex - 1 >= 0) flags[binIndex - 1] = PSYMODEL_IRRELEVANT
      if (binIndex + 1 < flags.length) flags[binIndex + 1] = PSYMODEL_IRRELEVANT
    }
  }

  return count
}

/**
 * Check if a frequency bin qualifies as tonal based on neighbor comparison
 *
 * A bin is considered tonal if it exceeds all specified neighbor bins
 * by at least the tonal threshold (7 dB).
 *
 * @param {Float32Array} psdDb - Power spectral density in dB
 * @param {number} binIndex - Index of the bin to test
 * @param {Int8Array} offsets - Neighbor offset pattern to check
 * @returns {boolean} True if the bin qualifies as tonal
 */
function isTonalWithOffsets(psdDb, binIndex, offsets) {
  const TONAL_THRESHOLD = 7.0
  const binPower = psdDb[binIndex]
  const arrayLength = psdDb.length

  for (let i = 0; i < offsets.length; i++) {
    const neighborIndex = binIndex + offsets[i]
    if (
      neighborIndex >= 0 &&
      neighborIndex < arrayLength &&
      binPower - psdDb[neighborIndex] < TONAL_THRESHOLD
    ) {
      return false
    }
  }
  return true
}

/**
 * Detect non-tonal maskers per critical band using linear power aggregation
 *
 * Groups unexamined frequency bins by critical band and calculates the energy
 * centroid for each band. Creates non-tonal maskers at the centroid positions
 * to represent the noise-like spectral content.
 *
 * @param {Object} psychoBuffers - Pre-allocated working buffers
 * @param {Int8Array} flags - Classification flags for each frequency bin
 * @param {Int32Array} nonTonalIdx - Output array for non-tonal masker indices
 * @param {number} offsetDb - dB offset for power normalization
 * @returns {number} Number of non-tonal maskers detected
 */
function findNonTonalMaskers(psychoBuffers, flags, nonTonalIdx, offsetDb) {
  const linPower = psychoBuffers.linPower

  let count = 0
  const cbList = PSYMODEL_CRITICAL_BANDS
  const mapLen = PSYMODEL_FREQ_TO_CB_MAP.length
  const flagsLen = flags.length

  for (let bandIndex = 0; bandIndex < cbList.length - 1; bandIndex++) {
    const currentBandIdx = cbList[bandIndex]
    const bandStartBin = PSYMODEL_THRESHOLD_TABLE[currentBandIdx][0] - 1
    const bandEndBin = PSYMODEL_THRESHOLD_TABLE[cbList[bandIndex + 1]][0] - 1

    // Analyze critical band in linear power domain
    let totalLinearPower = 0
    let weightedLinearPower = 0
    const baseBarkValue = PSYMODEL_THRESHOLD_TABLE[currentBandIdx][1]

    const endBin = Math.min(bandEndBin, flagsLen)
    for (let binIndex = bandStartBin; binIndex < endBin; binIndex++) {
      if (flags[binIndex] === PSYMODEL_NOT_EXAMINED) {
        const binPower = linPower[binIndex]
        totalLinearPower += binPower
        if (binIndex < mapLen) {
          const barkValue =
            PSYMODEL_THRESHOLD_TABLE[PSYMODEL_FREQ_TO_CB_MAP[binIndex]][1]
          weightedLinearPower += binPower * (barkValue - baseBarkValue)
        }
        flags[binIndex] = PSYMODEL_IRRELEVANT
      }
    }

    if (totalLinearPower > 0) {
      // Calculate energy centroid offset within the critical band
      const centroidOffset =
        (weightedLinearPower / totalLinearPower) * (bandEndBin - bandStartBin)

      // Convert total power to dB: offsetDb + 10*log10(totalLinearPower)
      const maskerPowerDb =
        offsetDb + PSYMODEL_LOG10_FACTOR * Math.log(totalLinearPower)

      // Place non-tonal masker near energy centroid (avoid tonal slots)
      let maskerIndex = Math.round(bandStartBin + centroidOffset)
      maskerIndex =
        maskerIndex < 0
          ? 0
          : maskerIndex >= flagsLen
            ? flagsLen - 1
            : maskerIndex
      if (flags[maskerIndex] === PSYMODEL_TONAL && maskerIndex + 1 < flagsLen)
        maskerIndex++

      nonTonalIdx[count] = maskerIndex
      psychoBuffers.nonTonalSPL[count] = maskerPowerDb
      flags[maskerIndex] = PSYMODEL_NON_TONAL
      count++
    }
  }

  return count
}

/**
 * Remove weak maskers below absolute hearing threshold
 *
 * Filters out maskers that fall below the absolute threshold of hearing
 * using the psychoacoustic model's threshold table. Compacts the arrays
 * in-place to maintain efficiency.
 *
 * @param {Object} psychoBuffers - Pre-allocated working buffers
 * @param {Int8Array} flags - Classification flags for each frequency bin
 * @param {Int32Array} tonalIdx - Array of tonal masker indices
 * @param {Int32Array} nonTonalIdx - Array of non-tonal masker indices
 * @param {number} tonalCount - Number of detected tonal maskers
 * @param {number} nonTonalCount - Number of detected non-tonal maskers
 * @returns {Object} Counts of audible maskers after filtering
 */
function decimateMaskers(
  psychoBuffers,
  flags,
  tonalIdx,
  nonTonalIdx,
  tonalCount,
  nonTonalCount
) {
  const isAudible = (idx, spl) => {
    if (idx >= PSYMODEL_FREQ_TO_CB_MAP.length) return false
    const cb = PSYMODEL_FREQ_TO_CB_MAP[idx]
    return spl >= PSYMODEL_THRESHOLD_TABLE[cb][2]
  }

  let keptTonal = 0
  for (let i = 0; i < tonalCount; i++) {
    const idx = tonalIdx[i]
    const spl = psychoBuffers.tonalSPL[i]
    if (isAudible(idx, spl)) {
      // compact in-place
      if (keptTonal !== i) {
        tonalIdx[keptTonal] = idx
        psychoBuffers.tonalSPL[keptTonal] = spl
      }
      keptTonal++
    } else if (idx < flags.length) {
      flags[idx] = PSYMODEL_IRRELEVANT
    }
  }

  let keptNonTonal = 0
  for (let i = 0; i < nonTonalCount; i++) {
    const idx = nonTonalIdx[i]
    const spl = psychoBuffers.nonTonalSPL[i]
    if (isAudible(idx, spl)) {
      if (keptNonTonal !== i) {
        nonTonalIdx[keptNonTonal] = idx
        psychoBuffers.nonTonalSPL[keptNonTonal] = spl
      }
      keptNonTonal++
    } else if (idx < flags.length) {
      flags[idx] = PSYMODEL_IRRELEVANT
    }
  }

  return { tonal: keptTonal, nonTonal: keptNonTonal }
}

/**
 * Precompute masker features used in threshold summation
 *
 * Collects all audible maskers and precomputes their bark scale values,
 * tonal offsets, and masking function coefficients to optimize the
 * critical band threshold calculation.
 *
 * @param {Object} psychoBuffers - Pre-allocated working buffers
 * @param {Int32Array} tonalIdx - Array of tonal masker indices
 * @param {Int32Array} nonTonalIdx - Array of non-tonal masker indices
 * @param {Int8Array} maskIsTonal - Array indicating masker type (1=tonal, 0=non-tonal)
 * @param {number} tonalCount - Number of audible tonal maskers
 * @param {number} nonTonalCount - Number of audible non-tonal maskers
 * @returns {number} Total number of maskers collected
 */
function collectMaskers(
  psychoBuffers,
  tonalIdx,
  nonTonalIdx,
  maskIsTonal,
  tonalCount,
  nonTonalCount
) {
  const psd = psychoBuffers.psdDb
  const maskSpl = psychoBuffers.maskSpl
  const maskPsd = psychoBuffers.maskPsd
  const maskBark = psychoBuffers.maskBark
  const maskTonalOffset = psychoBuffers.maskTonalOffset
  const maskPsdF1 = psychoBuffers.maskPsdF1
  const maskPsdF2 = psychoBuffers.maskPsdF2

  let maskerIndex = 0

  // Process tonal maskers
  for (let i = 0; i < tonalCount; i++) {
    const binIndex = tonalIdx[i]
    if (binIndex < PSYMODEL_FREQ_TO_CB_MAP.length) {
      const barkValue =
        PSYMODEL_THRESHOLD_TABLE[PSYMODEL_FREQ_TO_CB_MAP[binIndex]][1]
      const soundPressureLevel = psychoBuffers.tonalSPL[i]
      const psdValue = psd[binIndex]

      maskSpl[maskerIndex] = soundPressureLevel
      maskPsd[maskerIndex] = psdValue
      maskBark[maskerIndex] = barkValue
      maskIsTonal[maskerIndex] = 1
      maskTonalOffset[maskerIndex] = -1.525 - 0.275 * barkValue - 4.5 // Tonal offset formula
      maskPsdF1[maskerIndex] = 0.4 * psdValue + 6.0
      maskPsdF2[maskerIndex] = 0.15 * psdValue
      maskerIndex++
    }
  }

  // Process non-tonal maskers
  for (let i = 0; i < nonTonalCount; i++) {
    const binIndex = nonTonalIdx[i]
    if (binIndex < PSYMODEL_FREQ_TO_CB_MAP.length) {
      const barkValue =
        PSYMODEL_THRESHOLD_TABLE[PSYMODEL_FREQ_TO_CB_MAP[binIndex]][1]
      const soundPressureLevel = psychoBuffers.nonTonalSPL[i]
      const psdValue = psd[binIndex]

      maskSpl[maskerIndex] = soundPressureLevel
      maskPsd[maskerIndex] = psdValue
      maskBark[maskerIndex] = barkValue
      maskIsTonal[maskerIndex] = 0
      maskTonalOffset[maskerIndex] = -1.525 - 0.175 * barkValue - 0.5 // Non-tonal offset formula
      maskPsdF1[maskerIndex] = 0.4 * psdValue + 6.0
      maskPsdF2[maskerIndex] = 0.15 * psdValue
      maskerIndex++
    }
  }

  return maskerIndex
}

/**
 * Calculate critical band masking thresholds using precomputed masker features
 *
 * Computes the masking threshold for each critical band by summing the
 * contributions from all maskers, taking into account the masking function
 * shape and bark scale distances.
 *
 * @param {Object} psychoBuffers - Pre-allocated working buffers
 * @param {Int32Array} tonalIdx - Array of tonal masker indices
 * @param {Int32Array} nonTonalIdx - Array of non-tonal masker indices
 * @param {Int8Array} maskIsTonal - Array indicating masker type
 * @param {number} tonalCount - Number of audible tonal maskers
 * @param {number} nonTonalCount - Number of audible non-tonal maskers
 */
function calculateCriticalBandThresholds(
  psychoBuffers,
  tonalIdx,
  nonTonalIdx,
  maskIsTonal,
  tonalCount,
  nonTonalCount
) {
  const cbList = PSYMODEL_CRITICAL_BANDS
  const thresholds = psychoBuffers.criticalBandThresholds

  const maskersCount = collectMaskers(
    psychoBuffers,
    tonalIdx,
    nonTonalIdx,
    maskIsTonal,
    tonalCount,
    nonTonalCount
  )
  const maskSpl = psychoBuffers.maskSpl
  const maskBark = psychoBuffers.maskBark
  const maskTonalOffset = psychoBuffers.maskTonalOffset
  const maskPsdF1 = psychoBuffers.maskPsdF1
  const maskPsdF2 = psychoBuffers.maskPsdF2

  // Calculate masking threshold for each critical band
  for (let bandIndex = 0; bandIndex < cbList.length; bandIndex++) {
    const bandData = PSYMODEL_THRESHOLD_TABLE[cbList[bandIndex]]
    const maskedBarkValue = bandData[1]
    const absoluteThreshold = bandData[2]

    // Start with absolute threshold of hearing (quiet threshold)
    let totalLinearEnergy = fromDb(absoluteThreshold)

    // Sum contributions from all maskers
    for (let maskerIdx = 0; maskerIdx < maskersCount; maskerIdx++) {
      const barkDistance = maskedBarkValue - maskBark[maskerIdx]

      // Check if masker is within effective masking range
      if (barkDistance >= -3 && barkDistance < 8) {
        // Calculate piecewise masking function using precomputed terms
        const f1 = maskPsdF1[maskerIdx]
        const f2 = maskPsdF2[maskerIdx]
        let maskingFunction

        if (barkDistance < -1.0) {
          maskingFunction = 17.0 * (barkDistance + 1.0) - f1
        } else if (barkDistance < 0.0) {
          maskingFunction = f1 * barkDistance
        } else if (barkDistance < 1.0) {
          maskingFunction = -17.0 * barkDistance
        } else {
          maskingFunction = -(barkDistance - 1.0) * (17.0 - f2) - 17.0
        }

        // Calculate final masked threshold and add to total
        const maskedThresholdDb =
          maskSpl[maskerIdx] + maskTonalOffset[maskerIdx] + maskingFunction
        totalLinearEnergy += fromDb(maskedThresholdDb)
      }
    }

    // Convert back to dB and store final threshold
    thresholds[bandIndex] = toDb(totalLinearEnergy)
  }
}
