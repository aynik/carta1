/**
 * Carta1 Audio Codec - Fast Fourier Transform
 *
 * This module implements a radix-2 Cooley-Tukey FFT algorithm for frequency domain
 * analysis used in psychoacoustic modeling and transient detection.
 */
export class FFT {
  /**
   * @private
   * Caches pre-computed tables for different FFT sizes.
   * @type {Map<number, { bitRev: Uint32Array, cos: Float32Array, sin: Float32Array }>}
   */
  static _cache = new Map()

  /**
   * Perform an in-place forward FFT on complex data.
   * @param {Float32Array} real - Real part of the input/output data. The array is modified in-place.
   * @param {Float32Array} imag - Imaginary part of the input/output data. The array is modified in-place.
   */
  static fft(real, imag) {
    const n = real.length
    if (n !== imag.length) {
      throw new Error('Real and imaginary arrays must have the same length.')
    }
    if ((n & (n - 1)) !== 0) {
      throw new Error('Input size must be a power of 2.')
    }
    if (n <= 1) return

    let cache = FFT._cache.get(n)
    if (!cache) {
      const log2n = Math.log2(n)

      const bitRev = new Uint32Array(n)
      for (let i = 1; i < n; i++) {
        bitRev[i] = (bitRev[i >>> 1] >>> 1) | ((i & 1) << (log2n - 1))
      }

      const cosTbl = new Float32Array(n / 2)
      const sinTbl = new Float32Array(n / 2)
      for (let i = 0; i < n / 2; i++) {
        const angle = (-2 * Math.PI * i) / n
        cosTbl[i] = Math.cos(angle)
        sinTbl[i] = Math.sin(angle)
      }
      cache = { bitRev, cos: cosTbl, sin: sinTbl }
      FFT._cache.set(n, cache)
    }

    const { bitRev, cos: cosTbl, sin: sinTbl } = cache

    for (let i = 0; i < n; i++) {
      const j = bitRev[i]
      if (j > i) {
        let temp
        temp = real[i]
        real[i] = real[j]
        real[j] = temp
        temp = imag[i]
        imag[i] = imag[j]
        imag[j] = temp
      }
    }

    for (let i = 0; i < n; i += 2) {
      const i1 = i + 1
      const tReal = real[i1]
      const tImag = imag[i1]

      const evenReal = real[i]
      const evenImag = imag[i]

      real[i] = evenReal + tReal
      imag[i] = evenImag + tImag
      real[i1] = evenReal - tReal
      imag[i1] = evenImag - tImag
    }

    if (n >= 4) {
      for (let i = 0; i < n; i += 4) {
        const evenIndex1 = i
        const oddIndex1 = i + 2
        const evenReal1 = real[evenIndex1]
        const evenImag1 = imag[evenIndex1]
        const tReal1 = real[oddIndex1]
        const tImag1 = imag[oddIndex1]

        real[evenIndex1] = evenReal1 + tReal1
        imag[evenIndex1] = evenImag1 + tImag1
        real[oddIndex1] = evenReal1 - tReal1
        imag[oddIndex1] = evenImag1 - tImag1

        const evenIndex2 = i + 1
        const oddIndex2 = i + 3

        const tReal2 = imag[oddIndex2]
        const tImag2 = -real[oddIndex2]

        const evenReal2 = real[evenIndex2]
        const evenImag2 = imag[evenIndex2]

        real[evenIndex2] = evenReal2 + tReal2
        imag[evenIndex2] = evenImag2 + tImag2
        real[oddIndex2] = evenReal2 - tReal2
        imag[oddIndex2] = evenImag2 - tImag2
      }
    }

    for (let stride = 8; stride <= n; stride <<= 1) {
      const halfStride = stride >>> 1
      const step = n / stride
      for (let i = 0; i < n; i += stride) {
        for (
          let k = 0, twiddleIndex = 0;
          k < halfStride;
          k++, twiddleIndex += step
        ) {
          const evenIndex = i + k
          const oddIndex = evenIndex + halfStride

          const cos_t = cosTbl[twiddleIndex]
          const sin_t = sinTbl[twiddleIndex]

          const tReal = real[oddIndex] * cos_t - imag[oddIndex] * sin_t
          const tImag = real[oddIndex] * sin_t + imag[oddIndex] * cos_t

          const evenReal = real[evenIndex]
          const evenImag = imag[evenIndex]

          real[evenIndex] = evenReal + tReal
          imag[evenIndex] = evenImag + tImag
          real[oddIndex] = evenReal - tReal
          imag[oddIndex] = evenImag - tImag
        }
      }
    }
  }
}
