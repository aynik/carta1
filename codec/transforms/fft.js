/**
 * Carta1 Audio Codec - Fast Fourier Transform
 * Optimized radix-2 Cooley-Tukey FFT implementation
 */
export class FFT {
  static _cache = new Map()

  /**
   * Perform an in-place forward FFT on complex data.
   * @param {Float32Array} real - Real part of the input/output data
   * @param {Float32Array} imag - Imaginary part of the input/output data
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
      cache = FFT._buildCache(n)
      FFT._cache.set(n, cache)
    }

    const { bitRev, cos: cosTbl, sin: sinTbl } = cache

    // Bit-reversal permutation with improved memory access pattern
    for (let i = 0; i < n; i++) {
      const j = bitRev[i]
      if (j > i) {
        // Use temporary variables to reduce array access
        const tempR = real[i]
        const tempI = imag[i]
        real[i] = real[j]
        imag[i] = imag[j]
        real[j] = tempR
        imag[j] = tempI
      }
    }

    // Optimized butterfly computations for small strides
    // Stride 2 - no twiddle factors needed
    for (let i = 0; i < n; i += 2) {
      const evenR = real[i]
      const evenI = imag[i]
      const oddR = real[i + 1]
      const oddI = imag[i + 1]

      real[i] = evenR + oddR
      imag[i] = evenI + oddI
      real[i + 1] = evenR - oddR
      imag[i + 1] = evenI - oddI
    }

    // Stride 4 - simple twiddle factors
    if (n >= 4) {
      for (let i = 0; i < n; i += 4) {
        // First pair (W^0 = 1)
        let evenR = real[i]
        let evenI = imag[i]
        let oddR = real[i + 2]
        let oddI = imag[i + 2]

        real[i] = evenR + oddR
        imag[i] = evenI + oddI
        real[i + 2] = evenR - oddR
        imag[i + 2] = evenI - oddI

        // Second pair (W^1 = -i)
        evenR = real[i + 1]
        evenI = imag[i + 1]
        oddR = real[i + 3]
        oddI = imag[i + 3]

        const tR = oddI // Multiplication by -i
        const tI = -oddR

        real[i + 1] = evenR + tR
        imag[i + 1] = evenI + tI
        real[i + 3] = evenR - tR
        imag[i + 3] = evenI - tI
      }
    }

    // Stride 8 - unrolled for better performance
    if (n >= 8) {
      for (let i = 0; i < n; i += 8) {
        // W^0 = 1
        let idx0 = i
        let idx4 = i + 4
        let r0 = real[idx0],
          i0 = imag[idx0]
        let r4 = real[idx4],
          i4 = imag[idx4]
        real[idx0] = r0 + r4
        imag[idx0] = i0 + i4
        real[idx4] = r0 - r4
        imag[idx4] = i0 - i4

        // W^1 = cos(-π/4) - i*sin(-π/4)
        let idx1 = i + 1
        let idx5 = i + 5
        r0 = real[idx1]
        i0 = imag[idx1]
        r4 = real[idx5]
        i4 = imag[idx5]
        const sqrt2_2 = 0.7071067811865476
        let tR = sqrt2_2 * (r4 + i4)
        let tI = sqrt2_2 * (i4 - r4)
        real[idx1] = r0 + tR
        imag[idx1] = i0 + tI
        real[idx5] = r0 - tR
        imag[idx5] = i0 - tI

        // W^2 = -i
        let idx2 = i + 2
        let idx6 = i + 6
        r0 = real[idx2]
        i0 = imag[idx2]
        r4 = real[idx6]
        i4 = imag[idx6]
        tR = i4
        tI = -r4
        real[idx2] = r0 + tR
        imag[idx2] = i0 + tI
        real[idx6] = r0 - tR
        imag[idx6] = i0 - tI

        // W^3 = cos(-3π/4) - i*sin(-3π/4)
        let idx3 = i + 3
        let idx7 = i + 7
        r0 = real[idx3]
        i0 = imag[idx3]
        r4 = real[idx7]
        i4 = imag[idx7]
        tR = sqrt2_2 * (-r4 + i4)
        tI = sqrt2_2 * (-r4 - i4)
        real[idx3] = r0 + tR
        imag[idx3] = i0 + tI
        real[idx7] = r0 - tR
        imag[idx7] = i0 - tI
      }
    }

    // General Cooley-Tukey butterflies with optimized inner loop
    for (let stride = 16; stride <= n; stride <<= 1) {
      const halfStride = stride >>> 1
      const step = n / stride

      // Process each group
      for (let grp = 0; grp < n; grp += stride) {
        // First butterfly (W^0 = 1) - no multiplication needed
        let evenIdx = grp
        let oddIdx = grp + halfStride
        const r0 = real[evenIdx]
        const i0 = imag[evenIdx]
        const r1 = real[oddIdx]
        const i1 = imag[oddIdx]
        real[evenIdx] = r0 + r1
        imag[evenIdx] = i0 + i1
        real[oddIdx] = r0 - r1
        imag[oddIdx] = i0 - i1

        // Remaining butterflies with twiddle factors
        let twiddleIdx = step
        for (let k = 1; k < halfStride; k++) {
          evenIdx = grp + k
          oddIdx = evenIdx + halfStride

          const cosW = cosTbl[twiddleIdx]
          const sinW = sinTbl[twiddleIdx]

          const oddR = real[oddIdx]
          const oddI = imag[oddIdx]
          const tR = oddR * cosW - oddI * sinW
          const tI = oddR * sinW + oddI * cosW

          const evenR = real[evenIdx]
          const evenI = imag[evenIdx]

          real[evenIdx] = evenR + tR
          imag[evenIdx] = evenI + tI
          real[oddIdx] = evenR - tR
          imag[oddIdx] = evenI - tI

          twiddleIdx += step
        }
      }
    }
  }

  /**
   * Build cache tables for FFT of size n
   * @private
   */
  static _buildCache(n) {
    const log2n = Math.log2(n) | 0

    // Optimized bit-reversal using iterative approach
    const bitRev = new Uint32Array(n)
    for (let i = 1; i < n; i++) {
      bitRev[i] = (bitRev[i >>> 1] >>> 1) | ((i & 1) << (log2n - 1))
    }

    // Pre-compute twiddle factors with better precision
    const halfN = n >>> 1
    const cosTbl = new Float32Array(halfN)
    const sinTbl = new Float32Array(halfN)

    // Use higher precision calculation then cast to Float32
    const angleStep = (-2 * Math.PI) / n
    for (let i = 0; i < halfN; i++) {
      const angle = angleStep * i
      cosTbl[i] = Math.fround(Math.cos(angle))
      sinTbl[i] = Math.fround(Math.sin(angle))
    }

    return { bitRev, cos: cosTbl, sin: sinTbl }
  }
}
