/**
 * Carta1 stream state and reusable scratch.
 */

import {
  BFU_DISTORTION_CACHE_STRIDE,
  NUM_BFUS,
  QMF_ANALYSIS_DELAY_SAMPLES,
  QMF_BANDS,
  QMF_HIGH_BAND_DELAY,
  QMF_SYNTHESIS_DELAY_SAMPLES,
} from './core/constants.js'
import { SPECS_PER_BFU } from './core/tables.js'

/** Persistent delay state for one two-band QMF synthesis stage. */
class QmfSynthesisState {
  constructor() {
    this.delay = new Float32Array(QMF_SYNTHESIS_DELAY_SAMPLES)
    this.delayRow = 0
  }
}

/**
 * Values with meaning across chronological frames.
 */
class History {
  constructor() {
    this.qmfAnalysisDelays = {
      lowBand: new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES),
      midBand: new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES),
    }
    this.qmfSynthesisStates = {
      lowBand: new QmfSynthesisState(),
      midBand: new QmfSynthesisState(),
    }
    this.qmfHighBandDelay = new Float32Array(QMF_HIGH_BAND_DELAY)

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
 * Reusable per-stream scratch storage for Sound-Unit bit allocation.
 */
export class SoundUnitAllocationScratch {
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
 * Reusable storage with no meaning between operations.
 */
class Scratch {
  constructor() {
    this.allocationScratch = new SoundUnitAllocationScratch()

    this.transformBuffers = {
      64: new Float32Array(64),
      128: new Float32Array(128),
      256: new Float32Array(256),
      512: new Float32Array(512),
    }

    this.qmfScratch = {
      analysisWindows: {
        128: new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES + 128),
        256: new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES + 256),
        512: new Float32Array(QMF_ANALYSIS_DELAY_SAMPLES + 512),
      },
      highBandWindows: {
        128: new Float32Array(QMF_HIGH_BAND_DELAY + 128),
        256: new Float32Array(QMF_HIGH_BAND_DELAY + 256),
      },
      polyphase: new Float32Array(QMF_BANDS),
      extended: new Float64Array(QMF_BANDS),
      bands: new Float32Array(QMF_BANDS),
    }

    this.mdctBuffers = {
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

/**
 * Own one chronological stream's history and reusable storage.
 */
export class BufferPool {
  constructor() {
    Object.assign(this, new History(), new Scratch())
  }
}
