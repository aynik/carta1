import { describe, it, expect } from 'vitest'
import { BufferPool } from '../codec/state'
import {
  QMF_ANALYSIS_DELAY_SAMPLES,
  QMF_HIGH_BAND_DELAY,
  QMF_SYNTHESIS_DELAY_SAMPLES,
} from '../codec/core/constants'

describe('BufferPool', () => {
  it('should initialize all buffers with correct sizes', () => {
    const pool = new BufferPool()

    // Transform buffers
    expect(pool.transformBuffers[64].length).toBe(64)
    expect(pool.transformBuffers[128].length).toBe(128)
    expect(pool.transformBuffers[256].length).toBe(256)
    expect(pool.transformBuffers[512].length).toBe(512)

    // QMF work buffers
    expect(pool.qmfScratch.analysisWindows[128].length).toBe(
      QMF_ANALYSIS_DELAY_SAMPLES + 128
    )
    expect(pool.qmfScratch.analysisWindows[256].length).toBe(
      QMF_ANALYSIS_DELAY_SAMPLES + 256
    )
    expect(pool.qmfScratch.analysisWindows[512].length).toBe(
      QMF_ANALYSIS_DELAY_SAMPLES + 512
    )
    expect(pool.qmfScratch.highBandWindows[128].length).toBe(
      QMF_HIGH_BAND_DELAY + 128
    )
    expect(pool.qmfScratch.highBandWindows[256].length).toBe(
      QMF_HIGH_BAND_DELAY + 256
    )

    // QMF delay lines
    expect(pool.qmfAnalysisDelays.lowBand.length).toBe(
      QMF_ANALYSIS_DELAY_SAMPLES
    )
    expect(pool.qmfAnalysisDelays.midBand.length).toBe(
      QMF_ANALYSIS_DELAY_SAMPLES
    )
    expect(pool.qmfSynthesisStates.lowBand.delay.length).toBe(
      QMF_SYNTHESIS_DELAY_SAMPLES
    )
    expect(pool.qmfSynthesisStates.midBand.delay.length).toBe(
      QMF_SYNTHESIS_DELAY_SAMPLES
    )
    expect(pool.qmfHighBandDelay.length).toBe(QMF_HIGH_BAND_DELAY)

    // Transient detector
    expect(pool.transientDetection[0].length).toBe(64)
    expect(pool.transientDetection[1].length).toBe(64)
    expect(pool.transientDetection[2].length).toBe(128)

    // MDCT/IMDCT work buffers
    expect(pool.mdctBuffers[16].real.length).toBe(16)
    expect(pool.mdctBuffers[16].imaginary.length).toBe(16)
    expect(pool.mdctBuffers[64].real.length).toBe(64)
    expect(pool.mdctBuffers[64].imaginary.length).toBe(64)
    expect(pool.mdctBuffers[128].real.length).toBe(128)
    expect(pool.mdctBuffers[128].imaginary.length).toBe(128)

    // MDCT overlap buffers
    expect(pool.mdctOverlap.length).toBe(3)
    expect(pool.mdctOverlap[0].length).toBe(32)

    // IMDCT overlap buffers
    expect(pool.imdctOverlap.length).toBe(3)
    expect(pool.imdctOverlap[0].length).toBe(256)

    // Spectrum reversal buffers
    expect(pool.reversalBuffers[32].length).toBe(32)
    expect(pool.reversalBuffers[128].length).toBe(128)
    expect(pool.reversalBuffers[256].length).toBe(256)
  })

  it('should have all buffers zero-initialized', () => {
    const pool = new BufferPool()

    const checkZero = (arr) => expect(arr.every((v) => v === 0)).toBe(true)

    checkZero(pool.transformBuffers[64])
    checkZero(pool.qmfScratch.analysisWindows[128])
    checkZero(pool.qmfAnalysisDelays.lowBand)
    checkZero(pool.transientDetection[0])
    checkZero(pool.mdctBuffers[16].real)
    checkZero(pool.mdctOverlap[0])
    checkZero(pool.imdctOverlap[0])
    checkZero(pool.reversalBuffers[32])
  })
})
