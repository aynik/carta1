/**
 * Carta1 Audio Codec - Transient Detection Module
 *
 * Detects transients using spectral flux analysis to prevent pre-echo artifacts.
 * Combines multiple spectral features to identify sudden changes in signal
 * characteristics that require special handling during encoding.
 */

import { FFT } from '../transforms/fft.js'

/**
 * Perform FFT on time-domain samples and return magnitude spectrum
 * @param {Float64Array} samples - Time-domain samples
 * @param {number} fftSize - FFT size (must be power of 2)
 * @returns {Float64Array} Magnitude spectrum (positive frequencies only)
 */
export function performFFT(samples, fftSize) {
  const real = new Float64Array(fftSize)
  const imag = new Float64Array(fftSize)

  // Copy samples with zero-padding if necessary
  const copyLen = Math.min(samples.length, fftSize)
  real.set(samples.subarray(0, copyLen))

  // Perform FFT
  FFT.fft(real, imag)

  // Calculate magnitude spectrum for positive frequencies
  const magnitude = new Float64Array(fftSize / 2)
  for (let i = 0; i < fftSize / 2; i++) {
    magnitude[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i])
  }

  return magnitude
}

/**
 * Detect transients by analyzing spectral changes between frames
 * @param {Float64Array} currentCoeffs - Current frame coefficients
 * @param {Float64Array} prevCoeffs - Previous frame coefficients
 * @param {number} threshold - Detection threshold
 * @returns {boolean} True if transient detected
 */
export function detectTransient(currentCoeffs, prevCoeffs, threshold) {
  // Can't detect transients without previous frame
  if (!prevCoeffs) return false

  // Calculate all spectral features
  const features = calculateSpectralFeatures(currentCoeffs, prevCoeffs)

  // Combine features using perceptually-motivated weighting
  const transientScore = calculateTransientScore(features)

  return transientScore > threshold
}

/**
 * Calculate all spectral features for transient detection
 * @param {Float64Array} currentCoeffs - Current frame coefficients
 * @param {Float64Array} prevCoeffs - Previous frame coefficients
 * @returns {Object} Computed spectral features
 */
function calculateSpectralFeatures(currentCoeffs, prevCoeffs) {
  // Calculate spectral flux (positive differences only)
  const spectralFlux = calculateSpectralFlux(currentCoeffs, prevCoeffs)

  // Calculate spectral flatness for both frames
  const currentFlatness = calculateSpectralFlatness(currentCoeffs)
  const prevFlatness = calculateSpectralFlatness(prevCoeffs)
  const flatnessChange = Math.abs(currentFlatness - prevFlatness)

  // Calculate high-frequency content ratio
  const currentHfRatio = calculateHighFrequencyRatio(currentCoeffs)
  const prevHfRatio = calculateHighFrequencyRatio(prevCoeffs)
  const hfChange = Math.abs(currentHfRatio - prevHfRatio)

  // Calculate energy change in dB
  const energyChange = calculateEnergyChange(currentCoeffs, prevCoeffs)

  return {
    spectralFlux,
    flatnessChange,
    hfChange,
    energyChange,
  }
}

/**
 * Calculate normalized spectral flux (positive spectral differences)
 * High values indicate sudden onset of new spectral components
 */
function calculateSpectralFlux(currentCoeffs, prevCoeffs) {
  let flux = 0
  let currentEnergy = 0

  for (let i = 0; i < currentCoeffs.length; i++) {
    const currentMag = Math.abs(currentCoeffs[i])
    const prevMag = Math.abs(prevCoeffs[i])

    // Only count positive differences (new energy)
    const diff = currentMag - prevMag
    if (diff > 0) {
      flux += diff
    }

    currentEnergy += currentMag * currentMag
  }

  // Normalize by current frame energy to make threshold independent of level
  const normalization = Math.sqrt(currentEnergy) || 1e-6
  return flux / normalization
}

/**
 * Calculate spectral flatness (geometric mean / arithmetic mean)
 * Measures how noise-like vs tonal the spectrum is
 * @param {Float64Array} coeffs - Spectral coefficients
 * @returns {number} Flatness measure (0 = tonal, 1 = noise-like)
 */
function calculateSpectralFlatness(coeffs) {
  const EPSILON = 1e-10
  let sumLog = 0
  let sumLinear = 0
  let validBins = 0

  for (let i = 0; i < coeffs.length; i++) {
    const magnitude = Math.abs(coeffs[i])
    if (magnitude > EPSILON) {
      sumLog += Math.log(magnitude)
      sumLinear += magnitude
      validBins++
    }
  }

  if (validBins === 0) return 0

  const geometricMean = Math.exp(sumLog / validBins)
  const arithmeticMean = sumLinear / validBins

  return arithmeticMean > EPSILON ? geometricMean / arithmeticMean : 0
}

/**
 * Calculate ratio of high-frequency to total energy
 * High values indicate bright/harsh sounds that are perceptually important
 * @param {Float64Array} coeffs - Spectral coefficients
 * @returns {number} High-frequency energy ratio (0-1)
 */
function calculateHighFrequencyRatio(coeffs) {
  const midPoint = Math.floor(coeffs.length / 2)
  let lowEnergy = 0
  let highEnergy = 0

  for (let i = 0; i < midPoint; i++) {
    lowEnergy += coeffs[i] * coeffs[i]
  }

  for (let i = midPoint; i < coeffs.length; i++) {
    highEnergy += coeffs[i] * coeffs[i]
  }

  const totalEnergy = lowEnergy + highEnergy
  return totalEnergy > 0 ? highEnergy / totalEnergy : 0
}

/**
 * Calculate energy change between frames in dB
 * @param {Float64Array} currentCoeffs - Current frame coefficients
 * @param {Float64Array} prevCoeffs - Previous frame coefficients
 * @returns {number} Energy change in dB (positive values only)
 */
function calculateEnergyChange(currentCoeffs, prevCoeffs) {
  let currentEnergy = 0
  let prevEnergy = 0

  for (let i = 0; i < currentCoeffs.length; i++) {
    currentEnergy += currentCoeffs[i] * currentCoeffs[i]
    prevEnergy += prevCoeffs[i] * prevCoeffs[i]
  }

  // Avoid log of zero and ensure minimum energy
  currentEnergy = Math.max(currentEnergy, 1e-10)
  prevEnergy = Math.max(prevEnergy, 1e-10)

  const changeDb = 10 * Math.log10(currentEnergy / prevEnergy)

  // Only interested in energy increases (potential transients)
  return Math.max(0, changeDb)
}

/**
 * Calculate unified transient score from spectral features
 * Uses perceptually-motivated combination instead of magic numbers
 * @param {Object} features - Spectral features
 * @returns {number} Transient score
 */
function calculateTransientScore(features) {
  const { spectralFlux, flatnessChange, hfChange, energyChange } = features

  // Spectral flux is the primary indicator - it directly measures
  // sudden onset of new frequency components
  const fluxContribution = spectralFlux

  // Flatness change indicates transition between tonal and noise-like
  // signals (e.g., pitched to unpitched percussion)
  // Scale by sqrt to reduce dominance
  const flatnessContribution = Math.sqrt(flatnessChange)

  // High-frequency changes are perceptually important but shouldn't
  // dominate the decision. Use log scaling for perceptual relevance
  const hfContribution = Math.log1p(hfChange * 10) / Math.log1p(10)

  // Energy changes in dB are already perceptually scaled
  // Normalize to 0-1 range assuming 30dB is a strong transient
  const energyContribution = Math.min(energyChange / 30, 1)

  // Combine features with equal perceptual importance
  // Each contribution is normalized to roughly 0-1 range
  return (
    (fluxContribution +
      flatnessContribution +
      hfContribution +
      energyContribution) /
    4
  )
}
