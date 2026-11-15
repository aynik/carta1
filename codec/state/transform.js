/** Fixed reusable transform storage for ATRAC1 QMF and MDCT kernels. */

import {
  MDCT_SIZE_LONG_HIGH,
  MDCT_SIZE_LONG_LOW_MID,
  MDCT_SIZE_SHORT,
  QMF_ANALYSIS_DELAY_SAMPLES,
  QMF_BANDS,
  QMF_HIGH_BAND_DELAY,
} from '../core/constants.js'

/** Reusable windows and polyphase accumulators for two-band QMF stages. */
export class QmfScratch {
  /** Allocate sliding analysis windows, high-band delay windows, and work rows. */
  constructor() {
    this.analysisWindows = {
      128: new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES + 128),
      256: new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES + 256),
      512: new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES + 512),
    }
    this.highBandWindows = {
      128: new Float32Array(QMF_HIGH_BAND_DELAY + 128),
      256: new Float32Array(QMF_HIGH_BAND_DELAY + 256),
    }
    this.polyphase = new Float32Array(QMF_BANDS)
    this.extended = new Float64Array(QMF_BANDS)
    this.bands = new Float32Array(QMF_BANDS)
  }
}

/** Fixed work vectors for forward MDCT and inverse IMDCT band transforms. */
export class MdctScratch {
  /** Allocate input/output framing buffers, complex FFT rows, and reversal buffers. */
  constructor() {
    this.transformBuffers = {
      64: new Float32Array(MDCT_SIZE_SHORT),
      128: new Float32Array(128),
      256: new Float32Array(MDCT_SIZE_LONG_LOW_MID),
      512: new Float32Array(MDCT_SIZE_LONG_HIGH),
    }
    this.fftBuffers = {
      16: {
        real: new Float32Array(16),
        imaginary: new Float32Array(16),
      },
      64: {
        real: new Float32Array(64),
        imaginary: new Float32Array(64),
      },
      128: {
        real: new Float32Array(128),
        imaginary: new Float32Array(128),
      },
    }
    this.reversalBuffers = {
      32: new Float32Array(32),
      128: new Float32Array(128),
      256: new Float32Array(256),
    }
  }
}
