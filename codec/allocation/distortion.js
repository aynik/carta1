/**
 * Carta1 perceptual masking and reconstruction distortion measurement.
 */

import {
  BFU_DISTORTION_CACHE_STRIDE,
  HEARING_THRESHOLD_ENERGY_GATE,
  MASK_EXPONENT_LONG,
  MASK_EXPONENT_SHORT,
  MASK_MIN_FLOOR,
  MASK_RELATIVE_FLOOR,
  MAX_BFU_SIZE,
} from '../core/constants.js'
import {
  EAR_WEIGHT_LONG,
  EAR_WEIGHT_SHORT,
  INVERSE_LOG_BFU_SIZES,
  QUANTIZER_RANGES,
  SCALE_FACTORS,
  SCALE_FACTOR_TRIM_RATIOS,
  SPREAD_DOWN,
  SPREAD_UP,
} from '../core/tables.js'

/**
 * Measure exact mid-tread ATRAC1 quantization squared error for one BFU.
 *
 * @param {Float32Array} bfu
 * @param {i32} size
 * @param {i32} scaleFactorIndex
 * @param {i32} wordLength
 * @returns {f64}
 * @nativeUnchecked Native callers supply frame-bounded buffers and indices.
 */
export function measureBfuQuantizationError(
  bfu,
  size,
  scaleFactorIndex,
  wordLength
) {
  if (wordLength <= 0) {
    /** @type {f64} */
    let energy = 0.0
    for (let i = 0; i < size; i++) {
      const value = bfu[i]
      energy += value * value
    }
    return energy
  }

  const quantizerRange = QUANTIZER_RANGES[wordLength]
  const scaleFactor = SCALE_FACTORS[scaleFactorIndex]
  const normalizationFactor = quantizerRange / scaleFactor
  const inverseQuantizerRange = 1.0 / quantizerRange
  /** @type {f64} */
  let error = 0.0

  for (let i = 0; i < size; i++) {
    const coefficient = bfu[i]
    const scaled = coefficient * normalizationFactor
    /** @type {i32} */
    let quantizedCode = 0
    if (scaled >= quantizerRange) {
      quantizedCode = quantizerRange
    } else if (scaled <= -quantizerRange) {
      quantizedCode = -quantizerRange
    } else {
      quantizedCode = (scaled + (scaled >= 0.0 ? 0.5 : -0.5)) | 0
    }
    const dequantizedValue = quantizedCode * scaleFactor * inverseQuantizerRange
    const difference = coefficient - dequantizedValue
    error += difference * difference
  }

  return error
}

/**
 * Look up or compute the lazily cached BFU distortion for a candidate word length.
 *
 * @param {i32} bfuIndex
 * @param {i32} wordLength
 * @param {Array<Float32Array>} bfuData
 * @param {Array<number>} bfuSizes
 * @param {Int32Array} initialScaleFactorIndices
 * @param {Float64Array} maxAmplitudes
 * @param {Float64Array} distortionCache
 * @returns {f64}
 * @nativeUnchecked Native callers supply frame-bounded buffers and indices.
 */
export function getCachedBfuDistortion(
  bfuIndex,
  wordLength,
  bfuData,
  bfuSizes,
  initialScaleFactorIndices,
  maxAmplitudes,
  distortionCache
) {
  const slot = bfuIndex * BFU_DISTORTION_CACHE_STRIDE + wordLength
  const cached = distortionCache[slot]
  if (cached >= 0.0) return cached

  let scaleFactorIndex = initialScaleFactorIndices[bfuIndex]
  if (
    wordLength > 0 &&
    scaleFactorIndex > 0 &&
    SCALE_FACTORS[scaleFactorIndex - 1] >=
      maxAmplitudes[bfuIndex] * SCALE_FACTOR_TRIM_RATIOS[wordLength]
  ) {
    scaleFactorIndex = scaleFactorIndex - 1
  }

  /** @type {Float32Array} */
  const bfu = bfuData[bfuIndex]
  const size = bfuSizes[bfuIndex] | 0
  const distortion = measureBfuQuantizationError(
    bfu,
    size,
    scaleFactorIndex,
    wordLength
  )
  distortionCache[slot] = distortion
  return distortion
}

/**
 * Build per-BFU simultaneous masking thresholds with short-block time-slice isolation.
 *
 * @param {Float64Array} energies
 * @param {Float64Array} maxAmplitudes
 * @param {Array<number>} bfuSizes
 * @param {i32} maxBfuCount
 * @param {f64} totalEnergy
 * @param {i32} lowBandMode
 * @param {i32} midBandMode
 * @param {i32} highBandMode
 * @param {Float64Array} maskThresholds
 * @returns {void}
 * @nativeUnchecked Native callers supply frame-bounded buffers and indices.
 */
export function buildPerceptualMask(
  energies,
  maxAmplitudes,
  bfuSizes,
  maxBfuCount,
  totalEnergy,
  lowBandMode,
  midBandMode,
  highBandMode,
  maskThresholds
) {
  for (let unit = 0; unit < maxBfuCount; unit++) {
    maskThresholds[unit] = 0.0
  }

  const downSpan = SPREAD_DOWN.length - 1
  const upLength = SPREAD_UP.length

  for (let sourceUnit = 0; sourceUnit < maxBfuCount; sourceUnit++) {
    const energy = energies[sourceUnit]
    if (energy <= 0.0) continue

    const size = bfuSizes[sourceUnit] | 0
    if (size <= 0) continue

    const peak = maxAmplitudes[sourceUnit]
    const peakEnergy = peak * peak
    const rawConcentration = (peakEnergy * size) / energy
    const concentration = rawConcentration < 1.0 ? 1.0 : rawConcentration
    /** @type {f64} */
    let inverseLogSize = 0.0
    if (size <= MAX_BFU_SIZE) {
      inverseLogSize = INVERSE_LOG_BFU_SIZES[size]
    } else {
      inverseLogSize = 1.0 / Math.log(size)
    }
    const shape =
      size > 1 ? Math.min(1.0, Math.log(concentration) * inverseLogSize) : 0.0

    let isShort = false
    let frequencyPosition = sourceUnit
    if (sourceUnit < 20) {
      isShort = lowBandMode !== 0
      if (isShort) frequencyPosition = (sourceUnit >> 2) * 4
    } else if (sourceUnit < 36) {
      isShort = midBandMode !== 0
      if (isShort) frequencyPosition = 20 + ((sourceUnit - 20) >> 2) * 4
    } else {
      isShort = highBandMode !== 0
      if (isShort) frequencyPosition = 36 + ((sourceUnit - 36) >> 3) * 8
    }

    const tonal = 14.5 + frequencyPosition * 0.3
    const offset = shape * tonal + (1.0 - shape) * 5.5
    const level = energy * Math.pow(10.0, -offset * 0.1)
    if (level <= 0.0) continue

    if (!isShort) {
      let lowerLimit = 0
      if (sourceUnit >= 36) {
        lowerLimit = midBandMode !== 0 ? 36 : 0
      } else if (sourceUnit >= 20) {
        lowerLimit = lowBandMode !== 0 ? 20 : 0
      }

      let upperLimit = maxBfuCount
      if (sourceUnit < 20) {
        if (midBandMode !== 0 && 20 < maxBfuCount) upperLimit = 20
      } else if (sourceUnit < 36) {
        if (highBandMode !== 0 && 36 < maxBfuCount) upperLimit = 36
      }

      /** @type {i32} */
      const candidateLower = sourceUnit - downSpan
      /** @type {i32} */
      const firstLower =
        candidateLower > lowerLimit ? candidateLower : lowerLimit
      for (let target = firstLower; target < sourceUnit; target++) {
        maskThresholds[target] =
          maskThresholds[target] + level * SPREAD_DOWN[sourceUnit - target]
      }

      /** @type {i32} */
      const candidateUpper = sourceUnit + upLength
      /** @type {i32} */
      const upperEnd = candidateUpper < upperLimit ? candidateUpper : upperLimit
      for (let target = sourceUnit; target < upperEnd; target++) {
        maskThresholds[target] =
          maskThresholds[target] + level * SPREAD_UP[target - sourceUnit]
      }
    } else {
      let bandBase = 0
      let strideShift = 2
      let timeSlice = 0
      let frequencyGroup = 0
      let frequencyGroupCount = 5
      if (sourceUnit < 20) {
        bandBase = 0
        strideShift = 2
        timeSlice = sourceUnit & 3
        frequencyGroup = sourceUnit >> 2
        frequencyGroupCount = 5
      } else if (sourceUnit < 36) {
        bandBase = 20
        strideShift = 2
        timeSlice = (sourceUnit - 20) & 3
        frequencyGroup = (sourceUnit - 20) >> 2
        frequencyGroupCount = 4
      } else {
        bandBase = 36
        strideShift = 3
        timeSlice = (sourceUnit - 36) & 7
        frequencyGroup = (sourceUnit - 36) >> 3
        frequencyGroupCount = 2
      }

      for (let downOffset = 1; downOffset <= downSpan; downOffset++) {
        const targetGroup = frequencyGroup - downOffset
        if (targetGroup >= 0) {
          const target = bandBase + (targetGroup << strideShift) + timeSlice
          if (target < maxBfuCount) {
            maskThresholds[target] =
              maskThresholds[target] + level * SPREAD_DOWN[downOffset]
          }
        }
      }

      for (let upOffset = 0; upOffset < upLength; upOffset++) {
        const targetGroup = frequencyGroup + upOffset
        if (targetGroup < frequencyGroupCount) {
          const target = bandBase + (targetGroup << strideShift) + timeSlice
          if (target < maxBfuCount) {
            maskThresholds[target] =
              maskThresholds[target] + level * SPREAD_UP[upOffset]
          }
        }
      }
    }
  }

  const maskFloor =
    (totalEnergy / maxBfuCount) * MASK_RELATIVE_FLOOR + MASK_MIN_FLOOR
  for (let unit = 0; unit < maxBfuCount; unit++) {
    maskThresholds[unit] = maskThresholds[unit] + maskFloor
  }
}

/**
 * Derive perceptual error weights and continuous waterfill seed thresholds.
 *
 * @param {Float64Array} energies
 * @param {Float64Array} maxAmplitudes
 * @param {Int32Array} initialScaleFactorIndices
 * @param {Array<number>} bfuSizes
 * @param {i32} maxBfuCount
 * @param {f64} allocationBias
 * @param {i32} lowBandMode
 * @param {i32} midBandMode
 * @param {i32} highBandMode
 * @param {Float64Array} maskThresholds
 * @param {Float64Array} perceptualWeights
 * @param {Float64Array} seedThresholds
 * @returns {void}
 * @nativeUnchecked Native callers supply frame-bounded buffers and indices.
 */
export function buildPerceptualWeights(
  energies,
  maxAmplitudes,
  initialScaleFactorIndices,
  bfuSizes,
  maxBfuCount,
  allocationBias,
  lowBandMode,
  midBandMode,
  highBandMode,
  maskThresholds,
  perceptualWeights,
  seedThresholds
) {
  const biasExponent = (allocationBias - 1.0) * 0.5

  for (let unit = 0; unit < maxBfuCount; unit++) {
    const energy = energies[unit]
    const size = bfuSizes[unit] | 0
    if (energy <= 0.0 || size <= 0) {
      perceptualWeights[unit] = 0.0
      seedThresholds[unit] = -1e9
      continue
    }

    const isShort =
      unit < 20
        ? lowBandMode !== 0
        : unit < 36
          ? midBandMode !== 0
          : highBandMode !== 0
    /** @type {f64} */
    let earWeight = EAR_WEIGHT_LONG[unit]
    /** @type {f64} */
    let maskExponent = MASK_EXPONENT_LONG
    if (isShort) {
      earWeight = EAR_WEIGHT_SHORT[unit]
      maskExponent = MASK_EXPONENT_SHORT
    }
    const effectiveMask =
      maskThresholds[unit] +
      HEARING_THRESHOLD_ENERGY_GATE / Math.max(earWeight, 1e-6)
    /** @type {f64} */
    let weight = earWeight / Math.pow(effectiveMask, maskExponent)

    if (biasExponent !== 0.0) {
      const scaleFactorIndex = initialScaleFactorIndices[unit]
      /** @type {f64} */
      let referenceScaleFactor = SCALE_FACTORS[scaleFactorIndex]
      if (scaleFactorIndex === 0) {
        referenceScaleFactor = Math.max(maxAmplitudes[unit], 1e-12)
      }
      weight *= Math.pow(
        referenceScaleFactor * referenceScaleFactor,
        biasExponent
      )
    }

    perceptualWeights[unit] = weight
    const maxAmplitude = maxAmplitudes[unit]
    const effectiveVariance =
      0.5 * (energy / size) + 0.5 * maxAmplitude * maxAmplitude
    seedThresholds[unit] = 0.5 * Math.log2(effectiveVariance * weight)
  }
}
