import { describe, it, expect } from 'vitest'
import { analyzeQmf, synthesizeQmf } from '../codec/signal/qmf'
import { TEST_SIGNALS } from './testSignals'
import { BufferPool } from '../codec/state'
import {
  QMF_ANALYSIS_DELAY_SAMPLES,
  QMF_SYNTHESIS_DELAY_SAMPLES,
} from '../codec/core/constants'

function analyzePair(input, delay, scratch) {
  const window = scratch.analysisWindows[input.length]
  window.set(delay)
  window.set(input, delay.length)
  const bands = [
    new Float32Array(input.length / 2),
    new Float32Array(input.length / 2),
  ]
  analyzeQmf(window, bands, scratch)
  delay.set(window.subarray(input.length))
  return bands
}

function synthesizePair(bands, state, scratch) {
  const output = new Float32Array(bands[0].length * 2)
  state.delayRow = synthesizeQmf(
    bands,
    state.delay,
    state.delayRow,
    output,
    scratch
  )
  return output
}

function synthesisState() {
  return {
    delay: new Float32Array(QMF_SYNTHESIS_DELAY_SAMPLES),
    delayRow: 0,
  }
}

describe('QMF Analysis and Synthesis', () => {
  const bufferPool = new BufferPool()

  it('should achieve perfect reconstruction', () => {
    const signal = TEST_SIGNALS.sine(440, 44100, 512)
    const delay = new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES)
    const bands = analyzePair(signal, delay, bufferPool.qmfScratch)
    const output = synthesizePair(
      bands,
      synthesisState(),
      bufferPool.qmfScratch
    )

    // The reconstruction is not bit-perfect due to floating point errors and filter delay.
    // We check that the energy is preserved and the error is small.
    const signalEnergy = signal.reduce((acc, val) => acc + val * val, 0)
    // The output is delayed by the analysis look-back.
    const errorEnergy = output.reduce((acc, val, i) => {
      const originalIndex = i - QMF_ANALYSIS_DELAY_SAMPLES
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

    const lowBandForLow = analyzePair(
      lowSignal,
      new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES),
      bufferPool.qmfScratch
    )[0]
    const highBandForHigh = analyzePair(
      highSignal,
      new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES),
      bufferPool.qmfScratch
    )[1]

    const lowEnergy = lowBandForLow.reduce((acc, val) => acc + val * val, 0)
    const highEnergy = highBandForHigh.reduce((acc, val) => acc + val * val, 0)

    expect(lowEnergy).toBeGreaterThan(highEnergy)
  })

  it('should handle delay correctly', () => {
    const signal = TEST_SIGNALS.impulse(0, 512)
    const bands = analyzePair(
      signal,
      new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES),
      bufferPool.qmfScratch
    )
    const output = synthesizePair(
      bands,
      synthesisState(),
      bufferPool.qmfScratch
    )

    // The peak of the impulse should be delayed by the analysis look-back.
    let maxVal = 0
    let maxIndex = -1
    for (let i = 0; i < output.length; i++) {
      if (output[i] > maxVal) {
        maxVal = output[i]
        maxIndex = i
      }
    }
    expect(maxIndex).toBe(QMF_ANALYSIS_DELAY_SAMPLES)
  })

  it('should demonstrate aliasing cancellation', () => {
    // A signal at Nyquist/2 should have its alias cancelled.
    const signal = TEST_SIGNALS.sine(11025, 44100, 512)
    const bands = analyzePair(
      signal,
      new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES),
      bufferPool.qmfScratch
    )
    const output = synthesizePair(
      bands,
      synthesisState(),
      bufferPool.qmfScratch
    )

    const signalEnergy = signal.reduce((acc, val) => acc + val * val, 0)
    const errorEnergy = output.reduce((acc, val, i) => {
      const originalIndex = i - QMF_ANALYSIS_DELAY_SAMPLES
      if (originalIndex < 0 || originalIndex >= signal.length) return acc
      return acc + (val - signal[originalIndex]) * (val - signal[originalIndex])
    }, 0)

    expect(errorEnergy / signalEnergy).toBeLessThan(1e-6)
  })
})
