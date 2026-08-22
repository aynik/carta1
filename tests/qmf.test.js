import { describe, it, expect } from 'vitest'
import { analyzeQmfPair, synthesizeQmfPair } from '../codec/signal/bands'
import { TEST_SIGNALS } from './testSignals'
import { BufferPool } from '../codec/state'
import { QMF_DELAY } from '../codec/core/constants'

describe('QMF Analysis and Synthesis', () => {
  const bufferPool = new BufferPool()

  it('should achieve perfect reconstruction', () => {
    const signal = TEST_SIGNALS.sine(440, 44100, 512)
    let delayLine = new Float32Array(QMF_DELAY)

    const { lowBand, highBand, newDelay } = analyzeQmfPair(
      signal,
      delayLine,
      bufferPool.qmfWorkBuffers
    )
    delayLine = newDelay

    const { output } = synthesizeQmfPair(
      lowBand,
      highBand,
      delayLine,
      bufferPool.qmfWorkBuffers
    )

    // The reconstruction is not bit-perfect due to floating point errors and filter delay.
    // We check that the energy is preserved and the error is small.
    const signalEnergy = signal.reduce((acc, val) => acc + val * val, 0)
    // The output is delayed by QMF_DELAY samples
    const errorEnergy = output.reduce((acc, val, i) => {
      const originalIndex = i - QMF_DELAY
      if (originalIndex < 0 || originalIndex >= signal.length) return acc
      return acc + (val - signal[originalIndex]) * (val - signal[originalIndex])
    }, 0)

    expect(errorEnergy / signalEnergy).toBeLessThan(1e-6)
  })

  it('should separate frequencies correctly', () => {
    const lowFreq = 1000
    const highFreq = 10000
    const sampleRate = 44100
    const size = 512

    const lowSignal = TEST_SIGNALS.sine(lowFreq, sampleRate, size)
    const highSignal = TEST_SIGNALS.sine(highFreq, sampleRate, size)

    let delayLine = new Float32Array(QMF_DELAY)

    const { lowBand: lowBandForLow } = analyzeQmfPair(
      lowSignal,
      delayLine,
      bufferPool.qmfWorkBuffers
    )
    const { highBand: highBandForHigh } = analyzeQmfPair(
      highSignal,
      delayLine,
      bufferPool.qmfWorkBuffers
    )

    const lowEnergy = lowBandForLow.reduce((acc, val) => acc + val * val, 0)
    const highEnergy = highBandForHigh.reduce((acc, val) => acc + val * val, 0)

    expect(lowEnergy).toBeGreaterThan(highEnergy)
  })

  it('should handle delay correctly', () => {
    const signal = TEST_SIGNALS.impulse(0, 512)
    let delayLine = new Float32Array(QMF_DELAY)

    const { lowBand, highBand, newDelay } = analyzeQmfPair(
      signal,
      delayLine,
      bufferPool.qmfWorkBuffers
    )
    const { output } = synthesizeQmfPair(
      lowBand,
      highBand,
      newDelay,
      bufferPool.qmfWorkBuffers
    )

    // The peak of the impulse should be delayed by QMF_DELAY
    let maxVal = 0
    let maxIndex = -1
    for (let i = 0; i < output.length; i++) {
      if (output[i] > maxVal) {
        maxVal = output[i]
        maxIndex = i
      }
    }
    expect(maxIndex).toBe(QMF_DELAY)
  })

  it('should demonstrate aliasing cancellation', () => {
    // A signal at Nyquist/2 should have its alias cancelled.
    const signal = TEST_SIGNALS.sine(11025, 44100, 512)
    let delayLine = new Float32Array(QMF_DELAY)

    const { lowBand, highBand, newDelay } = analyzeQmfPair(
      signal,
      delayLine,
      bufferPool.qmfWorkBuffers
    )
    const { output } = synthesizeQmfPair(
      lowBand,
      highBand,
      newDelay,
      bufferPool.qmfWorkBuffers
    )

    const signalEnergy = signal.reduce((acc, val) => acc + val * val, 0)
    const errorEnergy = output.reduce((acc, val, i) => {
      const originalIndex = i - QMF_DELAY
      if (originalIndex < 0 || originalIndex >= signal.length) return acc
      return acc + (val - signal[originalIndex]) * (val - signal[originalIndex])
    }, 0)

    expect(errorEnergy / signalEnergy).toBeLessThan(1e-6)
  })
})
