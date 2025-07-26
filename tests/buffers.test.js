import { describe, it, expect } from 'vitest'
import { BufferPool } from '../codec/core/buffers'
import {
  NUM_BFUS,
  MAX_BFU_SIZE,
  QMF_DELAY,
  QMF_HIGH_BAND_DELAY,
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
    expect(pool.qmfWorkBuffers.delay[128].length).toBe(QMF_DELAY + 128)
    expect(pool.qmfWorkBuffers.delay[256].length).toBe(QMF_DELAY + 256)
    expect(pool.qmfWorkBuffers.delay[512].length).toBe(QMF_DELAY + 512)
    expect(pool.qmfWorkBuffers.highBandDelay[128].length).toBe(
      QMF_HIGH_BAND_DELAY + 128
    )
    expect(pool.qmfWorkBuffers.highBandDelay[256].length).toBe(
      QMF_HIGH_BAND_DELAY + 256
    )

    // QMF delay lines
    expect(pool.qmfDelays.lowBand.length).toBe(QMF_DELAY)
    expect(pool.qmfDelays.midBand.length).toBe(QMF_DELAY)
    expect(pool.qmfDelays.highBand.length).toBe(QMF_HIGH_BAND_DELAY)

    // Transient detector
    expect(pool.transientDetection.prevLowCoeffs.length).toBe(128)
    expect(pool.transientDetection.prevMidCoeffs.length).toBe(128)
    expect(pool.transientDetection.prevHighCoeffs.length).toBe(256)

    // MDCT/IMDCT work buffers
    expect(pool.mdctBuffers[16].real.length).toBe(16)
    expect(pool.mdctBuffers[16].imag.length).toBe(16)
    expect(pool.mdctBuffers[64].real.length).toBe(64)
    expect(pool.mdctBuffers[64].imag.length).toBe(64)
    expect(pool.mdctBuffers[128].real.length).toBe(128)
    expect(pool.mdctBuffers[128].imag.length).toBe(128)

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

    // Bit allocation buffers
    expect(pool.bfuData.length).toBe(NUM_BFUS)
    expect(pool.bfuData[0].length).toBe(MAX_BFU_SIZE)
  })

  it('should have all buffers zero-initialized', () => {
    const pool = new BufferPool()

    const checkZero = (arr) => expect(arr.every((v) => v === 0)).toBe(true)

    checkZero(pool.transformBuffers[64])
    checkZero(pool.qmfWorkBuffers.delay[128])
    checkZero(pool.qmfDelays.lowBand)
    checkZero(pool.transientDetection.prevLowCoeffs)
    checkZero(pool.mdctBuffers[16].real)
    checkZero(pool.mdctOverlap[0])
    checkZero(pool.imdctOverlap[0])
    checkZero(pool.reversalBuffers[32])
    checkZero(pool.bfuData[0])
  })
})
