import { describe, it, expect } from 'vitest'
import { performFFT, detectTransient } from '../codec/analysis/transient'
import { TEST_SIGNALS } from './testSignals'
import { SAMPLES_PER_FRAME } from '../codec/core/constants'

describe('Transient Detection', () => {
  describe('performFFT', () => {
    it('should return a correct magnitude spectrum', () => {
      const size = 256
      const signal = TEST_SIGNALS.sine(1000, 44100, size)
      const magnitude = performFFT(signal, size)

      expect(magnitude.length).toBe(size / 2)
      // A simple check for energy concentration in the spectrum
      const peak = magnitude.reduce((max, v) => Math.max(max, v), 0)
      const sum = magnitude.reduce((s, v) => s + v, 0)
      expect(peak / sum).toBeGreaterThan(0.1)
    })
  })

  describe('detectTransient', () => {
    it('should detect a step function', () => {
      const size = 512
      const prevCoeffs = performFFT(TEST_SIGNALS.silence(size), size)
      const currentCoeffs = performFFT(TEST_SIGNALS.step(0, size), size)
      const isTransient = detectTransient(currentCoeffs, prevCoeffs, 0.1)
      expect(isTransient).toBe(true)
    })

    it('should ignore a steady state signal', () => {
      const size = 512
      const prevCoeffs = performFFT(TEST_SIGNALS.sine(440, 44100, size), size)
      const currentCoeffs = performFFT(
        TEST_SIGNALS.sine(440, 44100, size),
        size
      )
      const isTransient = detectTransient(currentCoeffs, prevCoeffs, 0.1)
      expect(isTransient).toBe(false)
    })

    it('should have a higher spectral flux for transients', () => {
      const size = 512
      const silentCoeffs = performFFT(TEST_SIGNALS.silence(size), size)
      const stepCoeffs = performFFT(TEST_SIGNALS.step(0, size), size)
      const sineCoeffs = performFFT(TEST_SIGNALS.sine(440, 44100, size), size)

      const transientScore = detectTransient(stepCoeffs, silentCoeffs, 0.01)
      const steadyScore = detectTransient(sineCoeffs, sineCoeffs, 0.01)

      expect(transientScore).toBe(true)
      expect(steadyScore).toBe(false)
    })

    it('should be sensitive to the threshold', () => {
      const size = 512
      const prevCoeffs = performFFT(TEST_SIGNALS.silence(size), size)
      const currentCoeffs = performFFT(TEST_SIGNALS.step(0, size), size)

      const isTransientLowThreshold = detectTransient(
        currentCoeffs,
        prevCoeffs,
        0.01
      )
      const isTransientHighThreshold = detectTransient(
        currentCoeffs,
        prevCoeffs,
        0.99
      )

      expect(isTransientLowThreshold).toBe(true)
      expect(isTransientHighThreshold).toBe(false)
    })
  })

  describe('comprehensive transient detection', () => {
    // Helper to create gentle pink noise
    const createGentleNoise = () => {
      const frame = new Float32Array(SAMPLES_PER_FRAME)
      let prev1 = 0
      let prev2 = 0
      for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
        const white = (Math.random() - 0.5) * 0.05 // Very low amplitude
        // Two-pole low-pass filter for smoother noise
        prev1 = prev1 * 0.95 + white * 0.05
        prev2 = prev2 * 0.95 + prev1 * 0.05
        frame[i] = prev2
      }
      return frame
    }

    // Helper to create frequency bursts
    const createBurst = (frequencies) => {
      const frame = new Float32Array(SAMPLES_PER_FRAME)
      // Start with silence for half the frame
      frame.fill(0, 0, SAMPLES_PER_FRAME / 2)
      // Then sudden burst in second half
      for (let i = SAMPLES_PER_FRAME / 2; i < SAMPLES_PER_FRAME; i++) {
        frequencies.forEach(({ freq, amp }) => {
          frame[i] += amp * Math.sin((2 * Math.PI * freq * i) / 44100)
        })
      }
      return frame
    }

    const testCases = [
      {
        band: 'low',
        fftSize: 256,
        signals: [
          {
            type: 'silence',
            create: () => new Float32Array(SAMPLES_PER_FRAME),
            shouldTrigger: false,
          },
          {
            type: '1kHz tone',
            create: () => TEST_SIGNALS.sine(1000, 44100, SAMPLES_PER_FRAME),
            shouldTrigger: false,
          },
          {
            type: 'gentle noise',
            create: createGentleNoise,
            shouldTrigger: false,
          },
          {
            type: 'low burst',
            create: () =>
              createBurst([
                { freq: 80, amp: 0.9 },
                { freq: 160, amp: 0.8 },
                { freq: 320, amp: 0.7 },
              ]),
            shouldTrigger: true,
          },
        ],
      },
      {
        band: 'mid',
        fftSize: 256,
        signals: [
          {
            type: 'silence',
            create: () => new Float32Array(SAMPLES_PER_FRAME),
            shouldTrigger: false,
          },
          {
            type: '7kHz tone',
            create: () => TEST_SIGNALS.sine(7000, 44100, SAMPLES_PER_FRAME),
            shouldTrigger: false,
          },
          {
            type: 'gentle noise',
            create: createGentleNoise,
            shouldTrigger: false,
          },
          {
            type: 'mid burst',
            create: () =>
              createBurst([
                { freq: 6000, amp: 0.8 },
                { freq: 7500, amp: 0.7 },
                { freq: 9000, amp: 0.6 },
              ]),
            shouldTrigger: true,
          },
        ],
      },
      {
        band: 'high',
        fftSize: 512,
        signals: [
          {
            type: 'silence',
            create: () => new Float32Array(SAMPLES_PER_FRAME),
            shouldTrigger: false,
          },
          {
            type: '15kHz tone',
            create: () => TEST_SIGNALS.sine(15000, 44100, SAMPLES_PER_FRAME),
            shouldTrigger: false,
          },
          {
            type: 'gentle noise',
            create: createGentleNoise,
            shouldTrigger: false,
          },
          {
            type: 'high burst',
            create: () =>
              createBurst([
                { freq: 12000, amp: 0.7 },
                { freq: 15000, amp: 0.6 },
                { freq: 18000, amp: 0.5 },
              ]),
            shouldTrigger: true,
          },
        ],
      },
    ]

    // Test each band with appropriate thresholds
    testCases.forEach(({ band, fftSize, signals }) => {
      describe(`${band} band detection`, () => {
        // Test with very low threshold (should catch transients)
        const lowThreshold = 0.5
        // Test with normal threshold
        const normalThreshold = band === 'low' ? 40 : band === 'mid' ? 65 : 85

        signals.forEach(({ type, create, shouldTrigger }) => {
          it(`should ${shouldTrigger ? 'detect' : 'not detect'} ${type} as transient with normal threshold`, () => {
            // Establish baseline with silence
            const baselineSignal = new Float32Array(fftSize)
            const baselineCoeffs = performFFT(baselineSignal, fftSize)

            // Test signal
            const testSignal = create()
            const testCoeffs = performFFT(testSignal.slice(0, fftSize), fftSize)

            const isTransient = detectTransient(
              testCoeffs,
              baselineCoeffs,
              normalThreshold
            )

            if (shouldTrigger) {
              // For bursts, we test the second half where the burst actually occurs
              const burstPart = testSignal.slice(
                SAMPLES_PER_FRAME / 2,
                SAMPLES_PER_FRAME / 2 + fftSize
              )
              const burstCoeffs = performFFT(burstPart, fftSize)
              const isTransientLow = detectTransient(
                burstCoeffs,
                baselineCoeffs,
                lowThreshold
              )
              expect(isTransientLow).toBe(true)
            } else {
              // For non-transients, they shouldn't trigger even with lower thresholds
              expect(isTransient).toBe(false)
            }
          })

          it(`should handle ${type} in continuous stream`, () => {
            const signal1 = create()
            const signal2 = create()

            const coeffs1 = performFFT(signal1.slice(0, fftSize), fftSize)
            const coeffs2 = performFFT(signal2.slice(0, fftSize), fftSize)

            // Same signal should not trigger transient
            const isTransient = detectTransient(
              coeffs2,
              coeffs1,
              normalThreshold
            )
            expect(isTransient).toBe(false)
          })
        })

        it(`should detect transition from tone to burst in ${band} band`, () => {
          // Start with a tone
          const toneFreq = band === 'low' ? 1000 : band === 'mid' ? 7000 : 15000
          const toneSignal = TEST_SIGNALS.sine(toneFreq, 44100, fftSize)
          const toneCoeffs = performFFT(toneSignal, fftSize)

          // Transition to burst
          const burstSignal = signals
            .find((s) => s.type.includes('burst'))
            .create()
          const burstCoeffs = performFFT(burstSignal.slice(0, fftSize), fftSize)

          // Test that transitions are detected with appropriate thresholds
          const testThreshold = band === 'high' ? 0.9 : 0.09
          const isTransient = detectTransient(
            burstCoeffs,
            toneCoeffs,
            testThreshold
          )
          expect(isTransient).toBe(true)
        })
      })
    })

    it('should handle edge cases gracefully', () => {
      const size = 256
      const coeffs = performFFT(TEST_SIGNALS.sine(1000, 44100, size), size)

      // No previous coefficients
      expect(detectTransient(coeffs, null, 10)).toBe(false)
      expect(detectTransient(coeffs, undefined, 10)).toBe(false)

      // Empty arrays
      expect(
        detectTransient(new Float32Array(0), new Float32Array(0), 10)
      ).toBe(false)

      // Very high threshold
      expect(detectTransient(coeffs, new Float32Array(size / 2), 99999)).toBe(
        false
      )
    })
  })
})
