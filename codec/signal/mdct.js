/**
 * Modified discrete cosine transforms backed by a complex FFT.
 *
 * The evaluation order is part of Carta1's numerical contract. The staged
 * Float32 decomposition used by Carta5 is mathematically equivalent but does
 * not preserve Carta1's encoded output or perceptual-quality floor.
 */

import { FFT } from './fft.js'
import { throwError } from '../utils.js'

/**
 * Base class for MDCT and IMDCT transforms
 */
class MdctBase {
  /**
   * @param {number} size - Transform size in samples
   * @param {number} scale - Transform normalization factor
   */
  constructor(size, scale) {
    this.size = size
    this.halfSize = size >> 1
    this.quarterSize = size >> 2
    this.fftSize = this.halfSize >> 1

    const alpha = (2.0 * Math.PI) / (8.0 * size)
    const omega = (2.0 * Math.PI) / size
    const scaleRoot = Math.sqrt(scale / size)

    this.sinCosTable = new Float64Array(this.halfSize)
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
export class MDCT extends MdctBase {
  constructor(size, scale) {
    super(size, scale)
  }

  /**
   * Perform forward MDCT transform
   * @param {Float32Array} input - Time-domain input samples
   * @param {Object} mdctBuffers - Required work buffers keyed by FFT size
   * @param {Float32Array|null} [destination=null] - Optional output buffer
   * @param {number} [destinationOffset=0] - First output index in destination
   * @returns {Float32Array} Frequency-domain MDCT coefficients
   * @throws {Error} If the required FFT work buffers are missing
   */
  transform(
    input,
    mdctBuffers = null,
    destination = null,
    destinationOffset = 0
  ) {
    const { halfSize, quarterSize, fftSize, sinCosTable } = this
    const buffers =
      mdctBuffers?.[fftSize] ??
      throwError(`MDCT.transform: mdctBuffers[${fftSize}] is required`)
    const real =
      buffers?.real ??
      throwError(`MDCT.transform: mdctBuffers[${fftSize}].real is required`)
    const imag =
      buffers?.imaginary ??
      throwError(
        `MDCT.transform: mdctBuffers[${fftSize}].imaginary is required`
      )

    const n4 = quarterSize
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
      const c = sinCosTable[i]
      const s = sinCosTable[i + 1]

      real[i >> 1] = r * c + im * s
      imag[i >> 1] = im * c - r * s
    }

    for (let i = n4; i < halfSize; i += 2) {
      const idx = i >> 1
      const i1 = n34 - 1 - i
      const i2 = i - n4
      const i3 = n4 + i
      const i4 = 5 * n4 - 1 - i

      const r = input[i1] - input[i2]
      const im = input[i3] + input[i4]
      const c = sinCosTable[i]
      const s = sinCosTable[i + 1]

      real[idx] = r * c + im * s
      imag[idx] = im * c - r * s
    }

    FFT.transform(real, imag)

    // Post-FFT processing
    const output = destination ?? new Float32Array(halfSize)
    for (let i = 0; i < fftSize; i++) {
      const c = sinCosTable[i * 2]
      const s = sinCosTable[i * 2 + 1]
      const re = real[i]
      const im = imag[i]

      output[destinationOffset + i * 2] = -re * c - im * s
      output[destinationOffset + halfSize - 1 - i * 2] = -re * s + im * c
    }

    return output
  }
}

/**
 * Inverse MDCT transform
 */
export class IMDCT extends MdctBase {
  constructor(size, scale = null) {
    super(size, scale || size)
  }

  /**
   * Perform inverse MDCT transform
   * @param {Float32Array} input - Frequency-domain MDCT coefficients
   * @param {Object} mdctBuffers - Required work buffers keyed by FFT size
   * @param {Float32Array|null} [destination=null] - Optional output buffer
   * @param {number} [destinationOffset=0] - First output index in destination
   * @returns {Float32Array} Time-domain output samples
   * @throws {Error} If the required FFT work buffers are missing
   */
  transform(
    input,
    mdctBuffers = null,
    destination = null,
    destinationOffset = 0
  ) {
    const { size, halfSize, quarterSize, fftSize, sinCosTable } = this
    const buffers =
      mdctBuffers?.[fftSize] ??
      throwError(`IMDCT.transform: mdctBuffers[${fftSize}] is required`)
    const real =
      buffers?.real ??
      throwError(`IMDCT.transform: mdctBuffers[${fftSize}].real is required`)
    const imag =
      buffers?.imaginary ??
      throwError(
        `IMDCT.transform: mdctBuffers[${fftSize}].imaginary is required`
      )

    const n4 = quarterSize
    const n34 = 3 * n4

    real.fill(0)
    imag.fill(0)

    // Pre-FFT processing
    for (let i = 0; i < fftSize; i++) {
      const i2 = i * 2
      const r = -input[i2]
      const im = -input[halfSize - 1 - i2]
      const c = sinCosTable[i2]
      const s = sinCosTable[i2 + 1]

      real[i] = im * s + r * c
      imag[i] = im * c - r * s
    }

    FFT.transform(real, imag)

    // Post-FFT butterfly
    const output = destination ?? new Float32Array(size)

    for (let i = 0; i < fftSize / 2; i++) {
      const i2 = i * 2
      const c = sinCosTable[i2]
      const s = sinCosTable[i2 + 1]
      const re = real[i]
      const im = imag[i]

      const r1 = re * c + im * s
      const i1 = re * s - im * c

      output[destinationOffset + n34 - 1 - i2] = r1
      output[destinationOffset + n34 + i2] = r1
      output[destinationOffset + n4 + i2] = i1
      output[destinationOffset + n4 - 1 - i2] = -i1
    }

    for (let i = fftSize / 2; i < fftSize; i++) {
      const idx = (i - fftSize / 2) * 2 + n4
      const i2 = i * 2
      const c = sinCosTable[i2]
      const s = sinCosTable[i2 + 1]
      const re = real[i]
      const im = imag[i]

      const r1 = re * c + im * s
      const i1 = re * s - im * c

      output[destinationOffset + n34 - 1 - idx] = r1
      output[destinationOffset + idx - n4] = -r1
      output[destinationOffset + n4 + idx] = i1
      output[destinationOffset + 5 * n4 - 1 - idx] = i1
    }

    return output
  }
}
