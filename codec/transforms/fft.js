/**
 * Carta1 Audio Codec - Fast Fourier Transform
 *
 * This module implements a radix-2 Cooley-Tukey FFT algorithm for frequency domain
 * analysis used in psychoacoustic modeling and transient detection.
 */
export class FFT {
  static _cache = new Map()

  /**
   * Perform in-place FFT on complex data
   * @param {Float32Array} real - Real part of input/output data
   * @param {Float32Array} imag - Imaginary part of input/output data
   */
  static fft(real, imag) {
    const n = real.length
    if (n !== imag.length)
      throw new Error('Real and imaginary arrays must have the same length.')
    if ((n & (n - 1)) !== 0) throw new Error('Input size must be a power of 2.')
    if (n <= 1) return

    let cache = FFT._cache.get(n)
    if (!cache) {
      // build plan in Float64 for precision
      const log2n = Math.log2(n)

      const bitRev = new Uint32Array(n)
      for (let i = 1; i < n; i++) {
        bitRev[i] = (bitRev[i >>> 1] >>> 1) | ((i & 1) << (log2n - 1))
      }

      const cosTbl = new Float64Array(n / 2)
      const sinTbl = new Float64Array(n / 2)
      for (let i = 0; i < n / 2; i++) {
        const angle = (-2 * Math.PI * i) / n
        // compute in f64, then enforce |W| = 1 to remove tiny drift
        let c = Math.cos(angle)
        let s = Math.sin(angle)
        const invm = 1 / Math.hypot(c, s) // ~1, but fixes cos^2+sin^2 drift
        cosTbl[i] = c * invm
        sinTbl[i] = s * invm
      }

      cache = { bitRev, cos: cosTbl, sin: sinTbl }
      FFT._cache.set(n, cache)
    }

    const { bitRev, cos: cosTbl, sin: sinTbl } = cache

    // work in Float64 to avoid per-stage Float32 rounding
    const needCopyBack =
      !(real instanceof Float64Array) || !(imag instanceof Float64Array)
    const r = needCopyBack ? new Float64Array(real) : real
    const im = needCopyBack ? new Float64Array(imag) : imag

    // bit reversal
    for (let i = 0; i < n; i++) {
      const j = bitRev[i]
      if (j > i) {
        let t = r[i]
        r[i] = r[j]
        r[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }

    // size-2 butterflies
    for (let i = 0; i < n; i += 2) {
      const i1 = i + 1
      const er = r[i],
        ei = im[i]
      const tr = r[i1],
        ti = im[i1]
      r[i] = er + tr
      im[i] = ei + ti
      r[i1] = er - tr
      im[i1] = ei - ti
    }

    // size-4 butterflies (uses exact W = -i at k=1)
    if (n >= 4) {
      for (let i = 0; i < n; i += 4) {
        const e0 = i,
          o0 = i + 2
        const er0 = r[e0],
          ei0 = im[e0]
        const tr0 = r[o0],
          ti0 = im[o0]
        r[e0] = er0 + tr0
        im[e0] = ei0 + ti0
        r[o0] = er0 - tr0
        im[o0] = ei0 - ti0

        const e1 = i + 1,
          o1 = i + 3
        const tr1 = im[o1] // multiply by -i
        const ti1 = -r[o1]
        const er1 = r[e1],
          ei1 = im[e1]
        r[e1] = er1 + tr1
        im[e1] = ei1 + ti1
        r[o1] = er1 - tr1
        im[o1] = ei1 - ti1
      }
    }

    // size >= 8
    for (let stride = 8; stride <= n; stride <<= 1) {
      const half = stride >>> 1
      const step = (n / stride) | 0
      for (let i = 0; i < n; i += stride) {
        let k = 0
        for (let j = 0; j < half; j++, k += step) {
          const even = i + j
          const odd = even + half

          const cr = cosTbl[k],
            sr = sinTbl[k]
          const orr = r[odd],
            oii = im[odd]

          const tr = orr * cr - oii * sr
          const ti = orr * sr + oii * cr

          const er = r[even],
            ei = im[even]
          r[even] = er + tr
          im[even] = ei + ti
          r[odd] = er - tr
          im[odd] = ei - ti
        }
      }
    }

    if (needCopyBack) {
      for (let i = 0; i < n; i++) {
        real[i] = r[i]
        imag[i] = im[i]
      }
    }
  }
}
