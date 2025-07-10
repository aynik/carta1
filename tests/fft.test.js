import { describe, it, expect } from 'vitest'
import { FFT } from '../codec/transforms/fft'
import { TEST_SIGNALS } from './testSignals'

describe('FFT', () => {
  const fftSizes = [16, 64, 256, 1024]

  it.each(fftSizes)(
    'should correctly calculate the DC component for size %i',
    (size) => {
      const real = TEST_SIGNALS.dc(1.0, size)
      const imag = new Float32Array(size)

      FFT.fft(real, imag)

      expect(real[0]).toBeCloseTo(size, 4)
      expect(imag[0]).toBeCloseTo(0, 4)

      for (let i = 1; i < size; i++) {
        expect(real[i]).toBeCloseTo(0, 4)
        expect(imag[i]).toBeCloseTo(0, 4)
      }
    }
  )

  it.each(fftSizes)(
    'should identify a single frequency sinusoid for size %i',
    (size) => {
      // Use a frequency that will fit within the FFT bin range
      // For proper FFT analysis, bin must be < size/2 (Nyquist)
      const targetBin = Math.floor(size / 8) // Use 1/8 of the FFT size
      const sampleRate = 44100
      const freq = (targetBin * sampleRate) / size

      const real = TEST_SIGNALS.sine(freq, sampleRate, size)
      const imag = new Float32Array(size)

      FFT.fft(real, imag)

      // For a pure sine wave, energy appears in both positive and negative frequency bins
      expect(Math.abs(imag[targetBin])).toBeGreaterThan(size / 4)
      expect(Math.abs(imag[size - targetBin])).toBeGreaterThan(size / 4)
    }
  )

  it.each(fftSizes)(
    "should satisfy Parseval's theorem (energy conservation) for size %i",
    (size) => {
      const real = TEST_SIGNALS.whiteNoise(1, size)
      const imag = new Float32Array(size)

      let timeEnergy = 0
      for (let i = 0; i < size; i++) {
        timeEnergy += real[i] * real[i]
      }

      FFT.fft(real, imag)

      let freqEnergy = 0
      for (let i = 0; i < size; i++) {
        freqEnergy += real[i] * real[i] + imag[i] * imag[i]
      }
      freqEnergy /= size

      expect(timeEnergy).toBeCloseTo(freqEnergy, 4)
    }
  )

  it.each(fftSizes)('should demonstrate linearity for size %i', (size) => {
    const signal1 = TEST_SIGNALS.sine(440, 44100, size)
    const signal2 = TEST_SIGNALS.sine(880, 44100, size)
    const combinedSignal = new Float32Array(size)
    for (let i = 0; i < size; i++) {
      combinedSignal[i] = signal1[i] + signal2[i]
    }

    const real1 = new Float32Array(signal1)
    const imag1 = new Float32Array(size)
    FFT.fft(real1, imag1)

    const real2 = new Float32Array(signal2)
    const imag2 = new Float32Array(size)
    FFT.fft(real2, imag2)

    const combinedReal = new Float32Array(combinedSignal)
    const combinedImag = new Float32Array(size)
    FFT.fft(combinedReal, combinedImag)

    for (let i = 0; i < size; i++) {
      expect(combinedReal[i]).toBeCloseTo(real1[i] + real2[i], 4)
      expect(combinedImag[i]).toBeCloseTo(imag1[i] + imag2[i], 4)
    }
  })
})
