/**
 * Carta1 Audio Codec - Fast Fourier Transform
 * Optimized radix-2 Cooley-Tukey FFT implementation
 */
export class FFT {
  static _cache = new Map()

  /**
   * Perform an in-place forward FFT on complex data.
   * @param {Float64Array} real - Real part of the input/output data
   * @param {Float64Array} imag - Imaginary part of the input/output data
   */
  static fft(real, imag) {
    const n = real.length
    if (n !== imag.length) throw new Error('Mismatched array lengths.')
    if ((n & (n - 1)) !== 0) throw new Error('Length must be power of 2.')
    if (n <= 1) return

    let cache = FFT._cache.get(n)
    if (!cache) {
      cache = FFT._buildCache(n)
      FFT._cache.set(n, cache)
    }

    const bitRev = cache.bitRev
    const cosTbl = cache.cos
    const sinTbl = cache.sin

    // Bit reversal
    for (let i = 0; i < n; i++) {
      const j = bitRev[i]
      if (j > i) {
        let tr = real[i]
        let ti = imag[i]
        real[i] = real[j]
        imag[i] = imag[j]
        real[j] = tr
        imag[j] = ti
      }
    }

    // First stage: stride=2
    for (let i = 0; i < n; i += 2) {
      let r0 = real[i],
        i0 = imag[i]
      let r1 = real[i + 1],
        i1 = imag[i + 1]
      real[i] = r0 + r1
      imag[i] = i0 + i1
      real[i + 1] = r0 - r1
      imag[i + 1] = i0 - i1
    }

    // Second stage: stride=4
    if (n >= 4) {
      for (let i = 0; i < n; i += 4) {
        let r0 = real[i],
          i0 = imag[i]
        let r2 = real[i + 2],
          i2 = imag[i + 2]
        real[i] = r0 + r2
        imag[i] = i0 + i2
        real[i + 2] = r0 - r2
        imag[i + 2] = i0 - i2

        r0 = real[i + 1]
        i0 = imag[i + 1]
        r2 = real[i + 3]
        i2 = imag[i + 3]
        // W^1 = -i
        let tR = i2
        let tI = -r2
        real[i + 1] = r0 + tR
        imag[i + 1] = i0 + tI
        real[i + 3] = r0 - tR
        imag[i + 3] = i0 - tI
      }
    }

    // Higher stages
    for (let stride = 8; stride <= n; stride <<= 1) {
      const halfStride = stride >>> 1
      const tblStep = n / stride
      for (let base = 0; base < n; base += stride) {
        // k = 0
        let r0 = real[base],
          i0 = imag[base]
        let r1 = real[base + halfStride],
          i1 = imag[base + halfStride]
        real[base] = r0 + r1
        imag[base] = i0 + i1
        real[base + halfStride] = r0 - r1
        imag[base + halfStride] = i0 - i1

        let tw = tblStep
        for (let k = 1; k < halfStride; k++) {
          const c = cosTbl[tw]
          const s = sinTbl[tw]
          r1 = real[base + k]
          i1 = imag[base + k]
          let r2 = real[base + k + halfStride]
          let i2 = imag[base + k + halfStride]
          let tr = r2 * c - i2 * s
          let ti = r2 * s + i2 * c
          real[base + k] = r1 + tr
          imag[base + k] = i1 + ti
          real[base + k + halfStride] = r1 - tr
          imag[base + k + halfStride] = i1 - ti
          tw += tblStep
        }
      }
    }
  }

  /**
   * Build cache tables for FFT of size n
   * @private
   */
  static _buildCache(n) {
    const bitRev = new Uint32Array(n)
    const log2n = Math.log2(n) | 0
    for (let i = 1; i < n; i++) {
      bitRev[i] = (bitRev[i >>> 1] >>> 1) | ((i & 1) << (log2n - 1))
    }
    const halfN = n >>> 1
    const cosTbl = new Float64Array(halfN)
    const sinTbl = new Float64Array(halfN)
    const ang = (-2 * Math.PI) / n
    for (let i = 0; i < halfN; i++) {
      const a = ang * i
      cosTbl[i] = Math.cos(a)
      sinTbl[i] = Math.sin(a)
    }
    return { bitRev, cos: cosTbl, sin: sinTbl }
  }
}
