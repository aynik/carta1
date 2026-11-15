/** Carta1 Audio Codec - Decoder state and stream initialization. */

import {
  MDCT_SIZE_LONG_HIGH,
  MDCT_SIZE_LONG_LOW_MID,
  QMF_HIGH_BAND_DELAY,
  QMF_SYNTHESIS_DELAY_SAMPLES,
} from '../core/constants.js'

/** Persistent delay state for one two-band QMF synthesis stage. */
export class QmfSynthesisState {
  /** Allocate the circular polyphase delay ring at row zero. */
  constructor() {
    this.delay = new Float32Array(QMF_SYNTHESIS_DELAY_SAMPLES)
    this.delayRow = 0
  }

  /**
   * Reset the delay ring and row cursor to neutral silence.
   *
   * @returns {QmfSynthesisState} This reset synthesis state.
   */
  reset() {
    this.delay.fill(0)
    this.delayRow = 0
    return this
  }
}

/** Committed cross-frame history for ATRAC1 decoding. */
export class DecoderState {
  /** Allocate neutral QMF and IMDCT overlap histories. */
  constructor() {
    this.qmfSynthesisStates = {
      lowBand: new QmfSynthesisState(),
      midBand: new QmfSynthesisState(),
    }
    this.qmfHighBandDelay = new Float32Array(QMF_HIGH_BAND_DELAY)
    this.imdctOverlap = [
      new Float32Array(MDCT_SIZE_LONG_LOW_MID),
      new Float32Array(MDCT_SIZE_LONG_LOW_MID),
      new Float32Array(MDCT_SIZE_LONG_HIGH),
    ]
  }

  /**
   * Reset committed cross-frame decoder history to neutral silence.
   *
   * @returns {DecoderState} This reset decoder state.
   */
  reset() {
    this.qmfSynthesisStates.lowBand.reset()
    this.qmfSynthesisStates.midBand.reset()
    this.qmfHighBandDelay.fill(0)
    for (let band = 0; band < this.imdctOverlap.length; band++) {
      this.imdctOverlap[band].fill(0)
    }
    return this
  }
}

/**
 * Reset persistent decoder histories before starting one stream.
 *
 * @param {object} decoder Decoder pool ownership root.
 * @returns {object} Initialized decoder storage.
 */
export function initializeDecoderStream(decoder) {
  decoder.state.reset()
  return decoder
}
