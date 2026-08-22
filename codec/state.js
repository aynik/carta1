/**
 * Carta1 stream state and reusable scratch.
 */

import { QMF_DELAY, QMF_HIGH_BAND_DELAY } from './core/constants.js'

/**
 * Values with meaning across chronological frames.
 */
class History {
  constructor() {
    this.qmfDelays = {
      lowBand: new Float32Array(QMF_DELAY),
      midBand: new Float32Array(QMF_DELAY),
      highBand: new Float32Array(QMF_HIGH_BAND_DELAY),
    }

    this.transientDetection = [
      new Float32Array(64),
      new Float32Array(64),
      new Float32Array(128),
    ]

    this.mdctOverlap = [
      new Float32Array(32),
      new Float32Array(32),
      new Float32Array(32),
    ]

    this.imdctOverlap = [
      new Float32Array(256),
      new Float32Array(256),
      new Float32Array(512),
    ]
  }
}

/**
 * Reusable storage with no meaning between operations.
 */
class Scratch {
  constructor() {
    this.transformBuffers = {
      64: new Float32Array(64),
      128: new Float32Array(128),
      256: new Float32Array(256),
      512: new Float32Array(512),
    }

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

    this.reversalBuffers = {
      32: new Float32Array(32),
      128: new Float32Array(128),
      256: new Float32Array(256),
    }
  }
}

/**
 * Own one chronological stream's history and reusable storage.
 */
export class BufferPool {
  constructor() {
    Object.assign(this, new History(), new Scratch())
  }
}
