/**
 * Carta1 Audio Codec - Modified Discrete Cosine Transform
 *
 * This module implements forward and inverse MDCT transforms for the ATRAC1 codec.
 * The MDCT provides time-frequency analysis with perfect reconstruction and
 * 50% overlap between adjacent blocks to avoid blocking artifacts.
 */

import { FFT } from './fft.js'
import {
  MDCT_SIZE_SHORT,
  MDCT_SIZE_MID,
  MDCT_SIZE_LONG,
} from '../core/constants.js'
import { throwError } from '../utils.js'

/**
 * Base class for MDCT and IMDCT transforms
 */
class MDCTBase {
  constructor(size, scale) {
    this.size = size
    this.halfSize = size >> 1
    this.quarterSize = size >> 2
    this.fftSize = this.halfSize >> 1

    const alpha = (2.0 * Math.PI) / (8.0 * size)
    const omega = (2.0 * Math.PI) / size
    const scaleRoot = Math.sqrt(scale / size)

    this.sinCosTable = new Float32Array(this.halfSize)
    for (let i = 0; i < this.quarterSize; i++) {
      const angle = omega * i + alpha
      this.sinCosTable[i * 2] = scaleRoot * Math.cos(angle)
      this.sinCosTable[i * 2 + 1] = scaleRoot * Math.sin(angle)
    }
  }
}

/**
 * Forward MDCT transform
 */
export class MDCT extends MDCTBase {
  constructor(size, scale) {
    super(size, scale)
  }

  /**
   * Perform forward MDCT transform
   * @param {Float32Array} input - Time-domain input samples
   * @param {Object} mdctBuffers - Optional work buffers for FFT
   * @returns {Float32Array} Frequency-domain MDCT coefficients
   */
  transform(input, mdctBuffers = null) {
    const buffers =
      mdctBuffers?.[this.fftSize] ??
      throwError(`MDCT.transform: mdctBuffers[${this.fftSize}] is required`)
    const real =
      buffers?.real ??
      throwError(
        `MDCT.transform: mdctBuffers[${this.fftSize}].real is required`
      )
    const imag =
      buffers?.imag ??
      throwError(
        `MDCT.transform: mdctBuffers[${this.fftSize}].imag is required`
      )

    const n4 = this.quarterSize
    const n34 = 3 * n4

    real.fill(0)
    imag.fill(0)

    // Pre-FFT butterfly
    for (let i = 0; i < n4; i += 2) {
      const i1 = n34 - 1 - i
      const i2 = n34 + i
      const i3 = n4 + i
      const i4 = n4 - 1 - i

      const r = input[i1] + input[i2]
      const im = input[i3] - input[i4]
      const c = this.sinCosTable[i]
      const s = this.sinCosTable[i + 1]

      real[i >> 1] = r * c + im * s
      imag[i >> 1] = im * c - r * s
    }

    for (let i = n4; i < this.halfSize; i += 2) {
      const idx = i >> 1
      const i1 = n34 - 1 - i
      const i2 = i - n4
      const i3 = n4 + i
      const i4 = 5 * n4 - 1 - i

      const r = input[i1] - input[i2]
      const im = input[i3] + input[i4]
      const c = this.sinCosTable[i]
      const s = this.sinCosTable[i + 1]

      real[idx] = r * c + im * s
      imag[idx] = im * c - r * s
    }

    FFT.fft(real, imag)

    // Post-FFT processing
    const output = new Float32Array(this.halfSize)
    for (let i = 0; i < this.fftSize; i++) {
      const c = this.sinCosTable[i * 2]
      const s = this.sinCosTable[i * 2 + 1]
      const re = real[i]
      const im = imag[i]

      output[i * 2] = -re * c - im * s
      output[this.halfSize - 1 - i * 2] = -re * s + im * c
    }

    return output
  }
}

/**
 * Inverse MDCT transform
 */
export class IMDCT extends MDCTBase {
  constructor(size, scale = null) {
    super(size, scale || size)
  }

  /**
   * Perform inverse MDCT transform
   * @param {Float32Array} input - Frequency-domain MDCT coefficients
   * @param {Object} mdctBuffers - Optional work buffers for FFT
   * @returns {Float32Array} Time-domain output samples
   */
  transform(input, mdctBuffers = null) {
    const buffers =
      mdctBuffers?.[this.fftSize] ??
      throwError(`IMDCT.transform: mdctBuffers[${this.fftSize}] is required`)
    const real =
      buffers?.real ??
      throwError(
        `IMDCT.transform: mdctBuffers[${this.fftSize}].real is required`
      )
    const imag =
      buffers?.imag ??
      throwError(
        `IMDCT.transform: mdctBuffers[${this.fftSize}].imag is required`
      )

    const n4 = this.quarterSize
    const n34 = 3 * n4

    real.fill(0)
    imag.fill(0)

    // Pre-FFT processing
    for (let i = 0; i < this.fftSize; i++) {
      const i2 = i * 2
      const r = input[i2]
      const im = input[this.halfSize - 1 - i2]
      const c = this.sinCosTable[i2]
      const s = this.sinCosTable[i2 + 1]

      real[i] = -2.0 * (im * s + r * c)
      imag[i] = -2.0 * (im * c - r * s)
    }

    FFT.fft(real, imag)

    // Post-FFT butterfly
    const output = new Float32Array(this.size)

    for (let i = 0; i < this.fftSize / 2; i++) {
      const i2 = i * 2
      const c = this.sinCosTable[i2]
      const s = this.sinCosTable[i2 + 1]
      const re = real[i]
      const im = imag[i]

      const r1 = re * c + im * s
      const i1 = re * s - im * c

      output[n34 - 1 - i2] = r1
      output[n34 + i2] = r1
      output[n4 + i2] = i1
      output[n4 - 1 - i2] = -i1
    }

    for (let i = this.fftSize / 2; i < this.fftSize; i++) {
      const idx = (i - this.fftSize / 2) * 2 + n4
      const i2 = i * 2
      const c = this.sinCosTable[i2]
      const s = this.sinCosTable[i2 + 1]
      const re = real[i]
      const im = imag[i]

      const r1 = re * c + im * s
      const i1 = re * s - im * c

      output[n34 - 1 - idx] = r1
      output[idx - n4] = -r1
      output[n4 + idx] = i1
      output[5 * n4 - 1 - idx] = i1
    }

    return output
  }
}

// Pre-instantiated transforms
export const mdct64 = new MDCT(MDCT_SIZE_SHORT, 0.5)
export const mdct256 = new MDCT(MDCT_SIZE_MID, 0.5)
export const mdct512 = new MDCT(MDCT_SIZE_LONG, 1.0)

export const imdct64 = new IMDCT(MDCT_SIZE_SHORT, MDCT_SIZE_SHORT * 4)
export const imdct256 = new IMDCT(MDCT_SIZE_MID, MDCT_SIZE_MID * 4)
export const imdct512 = new IMDCT(MDCT_SIZE_LONG, MDCT_SIZE_LONG * 2)

/**
 * Perform overlap-add operation for MDCT reconstruction
 * @param {Float32Array} prev - Previous block samples
 * @param {Float32Array} curr - Current block samples
 * @param {Float32Array} window - Window function coefficients
 * @returns {Float32Array} Overlap-added output samples
 */
export function overlapAdd(prev, curr, window) {
  const size = prev.length
  const output = new Float32Array(size * 2)

  for (let i = 0; i < size; i++) {
    const w1 = window[i]
    const w2 = window[2 * size - 1 - i]
    const p = prev[i]
    const c = curr[size - 1 - i]

    output[i] = p * w2 - c * w1
    output[2 * size - 1 - i] = p * w1 + c * w2
  }

  return output
}
