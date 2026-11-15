/** Carta1 Audio Codec - Encoder state and reusable analysis/allocation scratch. */

import {
  BFU_DISTORTION_CACHE_STRIDE,
  FFT_SIZE_HIGH,
  FFT_SIZE_LOW,
  FFT_SIZE_MID,
  MDCT_OVERLAP_SIZE,
  NUM_BFUS,
  QMF_ANALYSIS_DELAY_SAMPLES,
  QMF_HIGH_BAND_DELAY,
} from '../core/constants.js'
import { SPECS_PER_BFU } from '../core/tables.js'

/** Committed cross-frame history for ATRAC1 encoding. */
export class EncoderState {
  /** Allocate neutral QMF delays, transient history, and MDCT overlap rows. */
  constructor() {
    this.qmfAnalysisDelays = {
      lowBand: new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES),
      midBand: new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES),
    }
    this.qmfHighBandDelay = new Float32Array(QMF_HIGH_BAND_DELAY)
    this.transientDetection = [
      new Float32Array(FFT_SIZE_LOW / 2),
      new Float32Array(FFT_SIZE_MID / 2),
      new Float32Array(FFT_SIZE_HIGH / 2),
    ]
    this.mdctOverlap = [
      new Float32Array(MDCT_OVERLAP_SIZE),
      new Float32Array(MDCT_OVERLAP_SIZE),
      new Float32Array(MDCT_OVERLAP_SIZE),
    ]
  }

  /**
   * Reset committed cross-frame encoder history to neutral silence.
   *
   * @returns {EncoderState} This reset encoder state.
   */
  reset() {
    this.qmfAnalysisDelays.lowBand.fill(0)
    this.qmfAnalysisDelays.midBand.fill(0)
    this.qmfHighBandDelay.fill(0)
    for (let band = 0; band < this.transientDetection.length; band++) {
      this.transientDetection[band].fill(0)
    }
    for (let band = 0; band < this.mdctOverlap.length; band++) {
      this.mdctOverlap[band].fill(0)
    }
    return this
  }
}

/** Fixed FFT work buffers for transient detection across subbands. */
export class TransientAnalysisScratch {
  /** Allocate reusable complex FFT and magnitude rows per FFT size. */
  constructor() {
    this.fft = {
      128: {
        real: new Float32Array(FFT_SIZE_LOW),
        imaginary: new Float32Array(FFT_SIZE_LOW),
        magnitudes: new Float32Array(FFT_SIZE_LOW / 2),
      },
      256: {
        real: new Float32Array(FFT_SIZE_HIGH),
        imaginary: new Float32Array(FFT_SIZE_HIGH),
        magnitudes: new Float32Array(FFT_SIZE_HIGH / 2),
      },
    }
  }
}

/** Reusable per-stream scratch storage for Sound-Unit bit allocation. */
export class SoundUnitAllocationScratch {
  /** Allocate fixed BFU coefficient rows and solver work arrays. */
  constructor() {
    /** @type {Array<Float32Array>} */
    const bfuData = []
    /** @type {Array<number>} */
    const bfuSizes = []
    for (let i = 0; i < NUM_BFUS; i++) {
      const size = SPECS_PER_BFU[i]
      bfuData.push(new Float32Array(size))
      bfuSizes.push(size)
    }
    this.bfuData = bfuData
    this.bfuSizes = bfuSizes
    this.energies = new Float64Array(NUM_BFUS)
    this.maxAmplitudes = new Float64Array(NUM_BFUS)
    this.initialScaleFactorIndices = new Int32Array(NUM_BFUS)
    this.maskThresholds = new Float64Array(NUM_BFUS)
    this.perceptualWeights = new Float64Array(NUM_BFUS)
    this.seedThresholds = new Float64Array(NUM_BFUS)
    this.distortionCache = new Float64Array(
      NUM_BFUS * BFU_DISTORTION_CACHE_STRIDE
    )
    this.candidateWordLengths = new Int32Array(NUM_BFUS)
    this.selectedWordLengths = new Int32Array(NUM_BFUS)
    this.refinedScaleFactorIndices = new Int32Array(NUM_BFUS)
  }
}

/**
 * Reset persistent encoder histories before starting one stream.
 *
 * @param {object} encoder Encoder pool ownership root.
 * @returns {object} Initialized encoder storage.
 */
export function initializeEncoderStream(encoder) {
  encoder.state.reset()
  return encoder
}
