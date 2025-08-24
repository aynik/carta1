/**
 * Carta1 Audio Codec - Fast Fourier Transform
 *
 * This module implements a radix-2 Cooley-Tukey FFT algorithm for frequency domain
 * analysis used in psychoacoustic modeling and transient detection.
 */

export class FFT {
  /**
   * Perform in-place FFT on complex data
   * @param {Float32Array} real - Real part of input/output data
   * @param {Float32Array} imag - Imaginary part of input/output data
   */
  static fft(real, imag) {
    const size = real.length
    if (size === 1) return

    const bits = Math.log2(size)

    // Bit reversal
    for (let i = 0; i < size; i++) {
      let reversed = 0
      let temp = i
      for (let b = 0; b < bits; b++) {
        reversed = (reversed << 1) | (temp & 1)
        temp >>= 1
      }
      if (reversed > i) {
        ;[real[i], real[reversed]] = [real[reversed], real[i]]
        ;[imag[i], imag[reversed]] = [imag[reversed], imag[i]]
      }
    }

    // Cooley-Tukey decimation-in-time
    for (let stride = 2; stride <= size; stride <<= 1) {
      const halfStride = stride >> 1
      const angle = (-2 * Math.PI) / stride
      const wReal = Math.cos(angle)
      const wImag = Math.sin(angle)

      for (let start = 0; start < size; start += stride) {
        let twiddleReal = 1
        let twiddleImag = 0

        for (let k = 0; k < halfStride; k++) {
          const evenIndex = start + k
          const oddIndex = evenIndex + halfStride

          const evenReal = real[evenIndex]
          const evenImag = imag[evenIndex]
          const oddReal = real[oddIndex]
          const oddImag = imag[oddIndex]

          const tReal = oddReal * twiddleReal - oddImag * twiddleImag
          const tImag = oddReal * twiddleImag + oddImag * twiddleReal

          real[evenIndex] = evenReal + tReal
          imag[evenIndex] = evenImag + tImag
          real[oddIndex] = evenReal - tReal
          imag[oddIndex] = evenImag - tImag

          const nextReal = twiddleReal * wReal - twiddleImag * wImag
          twiddleImag = twiddleReal * wImag + twiddleImag * wReal
          twiddleReal = nextReal
        }
      }
    }
  }
}
