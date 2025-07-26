/**
 * Carta1 Audio Codec - Buffer Management
 */

import {
  NUM_BFUS,
  MAX_BFU_SIZE,
  QMF_DELAY,
  QMF_HIGH_BAND_DELAY,
} from './constants.js'

export class BufferPool {
  constructor() {
    // Transform buffers
    this.transformBuffers = {
      64: new Float32Array(64),
      128: new Float32Array(128),
      256: new Float32Array(256),
      512: new Float32Array(512),
    }

    // QMF work buffers
    this.qmfWorkBuffers = {
      delay: {
        128: new Float32Array(QMF_DELAY + 128),
        256: new Float32Array(QMF_DELAY + 256),
        512: new Float32Array(QMF_DELAY + 512),
      },
      highBandDelay: {
        128: new Float32Array(QMF_HIGH_BAND_DELAY + 128),
        256: new Float32Array(QMF_HIGH_BAND_DELAY + 256),
      },
    }

    // QMF delay lines
    this.qmfDelays = {
      lowBand: new Float32Array(QMF_DELAY),
      midBand: new Float32Array(QMF_DELAY),
      highBand: new Float32Array(QMF_HIGH_BAND_DELAY),
    }

    // Transient detector
    this.transientDetection = {
      prevLowCoeffs: new Float32Array(128),
      prevMidCoeffs: new Float32Array(128),
      prevHighCoeffs: new Float32Array(256),
    }

    // MDCT/IMDCT work buffers
    this.mdctBuffers = {
      16: {
        real: new Float32Array(16),
        imag: new Float32Array(16),
      },
      64: {
        real: new Float32Array(64),
        imag: new Float32Array(64),
      },
      128: {
        real: new Float32Array(128),
        imag: new Float32Array(128),
      },
    }

    // MDCT overlap buffers (encoder)
    this.mdctOverlap = [
      new Float32Array(32),
      new Float32Array(32),
      new Float32Array(32),
    ]

    // IMDCT overlap buffers (decoder)
    this.imdctOverlap = [
      new Float32Array(256),
      new Float32Array(256),
      new Float32Array(512),
    ]

    // Spectrum reversal buffers
    this.reversalBuffers = {
      32: new Float32Array(32),
      128: new Float32Array(128),
      256: new Float32Array(256),
    }

    // Bit allocation buffers
    this.bfuData = new Array(NUM_BFUS)
    for (let i = 0; i < NUM_BFUS; i++) {
      this.bfuData[i] = new Float32Array(MAX_BFU_SIZE)
    }
  }
}
