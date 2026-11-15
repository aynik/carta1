import { describe, it, expect } from 'vitest'
import {
  DecoderState,
  QmfSynthesisState,
  initializeDecoderStream,
} from '../codec/state/decoder'
import {
  EncoderState,
  SoundUnitAllocationScratch,
  TransientAnalysisScratch,
  initializeEncoderStream,
} from '../codec/state/encoder'
import { BufferPool } from '../codec/state/storage'
import { MdctScratch, QmfScratch } from '../codec/state/transform'
import {
  FFT_SIZE_HIGH,
  FFT_SIZE_LOW,
  FFT_SIZE_MID,
  MDCT_OVERLAP_SIZE,
  MDCT_SIZE_LONG_HIGH,
  MDCT_SIZE_LONG_LOW_MID,
  MDCT_SIZE_SHORT,
  NUM_BFUS,
  QMF_ANALYSIS_DELAY_SAMPLES,
  QMF_HIGH_BAND_DELAY,
  QMF_SYNTHESIS_DELAY_SAMPLES,
} from '../codec/core/constants'

describe('BufferPool', () => {
  it('should initialize encoder and decoder state and scratch with correct sizes', () => {
    const pool = new BufferPool()

    expect(pool.encoder.state).toBeInstanceOf(EncoderState)
    expect(pool.encoder.scratch.qmf).toBeInstanceOf(QmfScratch)
    expect(pool.encoder.scratch.transient).toBeInstanceOf(
      TransientAnalysisScratch
    )
    expect(pool.encoder.scratch.mdct).toBeInstanceOf(MdctScratch)
    expect(pool.encoder.scratch.allocation).toBeInstanceOf(
      SoundUnitAllocationScratch
    )

    expect(pool.decoder.state).toBeInstanceOf(DecoderState)
    expect(pool.decoder.scratch.mdct).toBeInstanceOf(MdctScratch)
    expect(pool.decoder.scratch.qmf).toBeInstanceOf(QmfScratch)
    expect(pool.encoder.scratch.qmf).not.toBe(pool.decoder.scratch.qmf)
    expect(pool.encoder.scratch.mdct).not.toBe(pool.decoder.scratch.mdct)

    // Transform buffers
    expect(
      pool.encoder.scratch.mdct.transformBuffers[MDCT_SIZE_SHORT].length
    ).toBe(64)
    expect(pool.encoder.scratch.mdct.transformBuffers[128].length).toBe(128)
    expect(
      pool.encoder.scratch.mdct.transformBuffers[MDCT_SIZE_LONG_LOW_MID].length
    ).toBe(256)
    expect(
      pool.encoder.scratch.mdct.transformBuffers[MDCT_SIZE_LONG_HIGH].length
    ).toBe(512)

    // QMF work buffers
    expect(pool.encoder.scratch.qmf.analysisWindows[128].length).toBe(
      QMF_ANALYSIS_DELAY_SAMPLES + 128
    )
    expect(pool.encoder.scratch.qmf.analysisWindows[256].length).toBe(
      QMF_ANALYSIS_DELAY_SAMPLES + 256
    )
    expect(pool.encoder.scratch.qmf.analysisWindows[512].length).toBe(
      QMF_ANALYSIS_DELAY_SAMPLES + 512
    )
    expect(pool.encoder.scratch.qmf.highBandWindows[128].length).toBe(
      QMF_HIGH_BAND_DELAY + 128
    )
    expect(pool.encoder.scratch.qmf.highBandWindows[256].length).toBe(
      QMF_HIGH_BAND_DELAY + 256
    )

    // QMF delay lines
    expect(pool.encoder.state.qmfAnalysisDelays.lowBand.length).toBe(
      QMF_ANALYSIS_DELAY_SAMPLES
    )
    expect(pool.encoder.state.qmfAnalysisDelays.midBand.length).toBe(
      QMF_ANALYSIS_DELAY_SAMPLES
    )
    expect(pool.encoder.state.qmfHighBandDelay.length).toBe(QMF_HIGH_BAND_DELAY)
    expect(pool.decoder.state.qmfSynthesisStates.lowBand).toBeInstanceOf(
      QmfSynthesisState
    )
    expect(pool.decoder.state.qmfSynthesisStates.lowBand.delay.length).toBe(
      QMF_SYNTHESIS_DELAY_SAMPLES
    )
    expect(pool.decoder.state.qmfSynthesisStates.midBand.delay.length).toBe(
      QMF_SYNTHESIS_DELAY_SAMPLES
    )
    expect(pool.decoder.state.qmfHighBandDelay.length).toBe(QMF_HIGH_BAND_DELAY)

    // Transient detector history and FFT scratch
    expect(pool.encoder.state.transientDetection[0].length).toBe(
      FFT_SIZE_LOW / 2
    )
    expect(pool.encoder.state.transientDetection[1].length).toBe(
      FFT_SIZE_MID / 2
    )
    expect(pool.encoder.state.transientDetection[2].length).toBe(
      FFT_SIZE_HIGH / 2
    )
    expect(pool.encoder.scratch.transient.fft[128].real.length).toBe(128)
    expect(pool.encoder.scratch.transient.fft[128].imaginary.length).toBe(128)
    expect(pool.encoder.scratch.transient.fft[128].magnitudes.length).toBe(64)
    expect(pool.encoder.scratch.transient.fft[256].real.length).toBe(256)
    expect(pool.encoder.scratch.transient.fft[256].imaginary.length).toBe(256)
    expect(pool.encoder.scratch.transient.fft[256].magnitudes.length).toBe(128)

    // MDCT/IMDCT work buffers
    for (const mdctScratch of [
      pool.encoder.scratch.mdct,
      pool.decoder.scratch.mdct,
    ]) {
      expect(mdctScratch.fftBuffers[16].real.length).toBe(16)
      expect(mdctScratch.fftBuffers[16].imaginary.length).toBe(16)
      expect(mdctScratch.fftBuffers[64].real.length).toBe(64)
      expect(mdctScratch.fftBuffers[64].imaginary.length).toBe(64)
      expect(mdctScratch.fftBuffers[128].real.length).toBe(128)
      expect(mdctScratch.fftBuffers[128].imaginary.length).toBe(128)
      expect(mdctScratch.reversalBuffers[32].length).toBe(32)
      expect(mdctScratch.reversalBuffers[128].length).toBe(128)
      expect(mdctScratch.reversalBuffers[256].length).toBe(256)
    }

    // MDCT and IMDCT overlap buffers
    expect(pool.encoder.state.mdctOverlap.length).toBe(3)
    expect(pool.encoder.state.mdctOverlap[0].length).toBe(MDCT_OVERLAP_SIZE)
    expect(pool.decoder.state.imdctOverlap.length).toBe(3)
    expect(pool.decoder.state.imdctOverlap[0].length).toBe(
      MDCT_SIZE_LONG_LOW_MID
    )
    expect(pool.decoder.state.imdctOverlap[2].length).toBe(MDCT_SIZE_LONG_HIGH)

    // Bit-allocation scratch
    expect(pool.encoder.scratch.allocation.bfuData.length).toBe(NUM_BFUS)
    expect(pool.encoder.scratch.allocation.energies.length).toBe(NUM_BFUS)
    expect(pool.encoder.scratch.allocation.distortionCache.length).toBe(
      NUM_BFUS * 16
    )
  })

  it('should have all buffers zero-initialized', () => {
    const pool = new BufferPool()

    const checkZero = (arr) => expect(arr.every((v) => v === 0)).toBe(true)

    checkZero(pool.encoder.scratch.mdct.transformBuffers[64])
    checkZero(pool.encoder.scratch.qmf.analysisWindows[128])
    checkZero(pool.encoder.state.qmfAnalysisDelays.lowBand)
    checkZero(pool.encoder.state.transientDetection[0])
    checkZero(pool.encoder.scratch.transient.fft[128].magnitudes)
    checkZero(pool.encoder.scratch.mdct.fftBuffers[16].real)
    checkZero(pool.encoder.state.mdctOverlap[0])
    checkZero(pool.encoder.scratch.mdct.reversalBuffers[32])
    checkZero(pool.encoder.scratch.allocation.energies)
    checkZero(pool.encoder.scratch.allocation.refinedScaleFactorIndices)

    checkZero(pool.decoder.state.qmfSynthesisStates.lowBand.delay)
    expect(pool.decoder.state.qmfSynthesisStates.lowBand.delayRow).toBe(0)
    checkZero(pool.decoder.state.qmfHighBandDelay)
    checkZero(pool.decoder.state.imdctOverlap[0])
    checkZero(pool.decoder.scratch.mdct.fftBuffers[16].real)
    checkZero(pool.decoder.scratch.qmf.analysisWindows[128])
  })

  it('resets encoder and decoder stream state in place without replacing typed arrays', () => {
    const pool = new BufferPool()

    const encoderState = pool.encoder.state
    const lowDelay = encoderState.qmfAnalysisDelays.lowBand
    const highDelay = encoderState.qmfHighBandDelay
    const transientHistory = encoderState.transientDetection[1]
    const overlap = encoderState.mdctOverlap[2]
    lowDelay.fill(1)
    highDelay.fill(2)
    transientHistory.fill(3)
    overlap.fill(4)
    pool.encoder.scratch.allocation.energies.fill(9)

    expect(initializeEncoderStream(pool.encoder)).toBe(pool.encoder)
    expect(encoderState.qmfAnalysisDelays.lowBand).toBe(lowDelay)
    expect(encoderState.qmfHighBandDelay).toBe(highDelay)
    expect(encoderState.transientDetection[1]).toBe(transientHistory)
    expect(encoderState.mdctOverlap[2]).toBe(overlap)
    expect(lowDelay.every((v) => v === 0)).toBe(true)
    expect(highDelay.every((v) => v === 0)).toBe(true)
    expect(transientHistory.every((v) => v === 0)).toBe(true)
    expect(overlap.every((v) => v === 0)).toBe(true)
    expect(pool.encoder.scratch.allocation.energies[0]).toBe(9)

    const decoderState = pool.decoder.state
    const synthLow = decoderState.qmfSynthesisStates.lowBand
    const synthDelay = synthLow.delay
    const decoderHighDelay = decoderState.qmfHighBandDelay
    const imdctOverlap = decoderState.imdctOverlap[0]
    synthDelay.fill(5)
    synthLow.delayRow = 11
    decoderHighDelay.fill(6)
    imdctOverlap.fill(7)

    expect(initializeDecoderStream(pool.decoder)).toBe(pool.decoder)
    expect(decoderState.qmfSynthesisStates.lowBand.delay).toBe(synthDelay)
    expect(synthLow.delayRow).toBe(0)
    expect(decoderState.qmfHighBandDelay).toBe(decoderHighDelay)
    expect(decoderState.imdctOverlap[0]).toBe(imdctOverlap)
    expect(synthDelay.every((v) => v === 0)).toBe(true)
    expect(decoderHighDelay.every((v) => v === 0)).toBe(true)
    expect(imdctOverlap.every((v) => v === 0)).toBe(true)
  })
})
