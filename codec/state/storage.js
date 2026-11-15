/** Carta1 Audio Codec - Reusable typed-array ownership. */

import {
  EncoderState,
  SoundUnitAllocationScratch,
  TransientAnalysisScratch,
} from './encoder.js'
import { DecoderState } from './decoder.js'
import { MdctScratch, QmfScratch } from './transform.js'

/**
 * Own reusable codec storage according to the lifetime of its contents.
 *
 * - `state` is committed history with meaning across chronological frames;
 * - `scratch` is private to one algorithm call and carries no stage meaning.
 */
export class BufferPool {
  /** Allocate neutral encoder and decoder storage. */
  constructor() {
    this.encoder = {
      state: new EncoderState(),
      scratch: {
        qmf: new QmfScratch(),
        transient: new TransientAnalysisScratch(),
        mdct: new MdctScratch(),
        allocation: new SoundUnitAllocationScratch(),
      },
    }

    this.decoder = {
      state: new DecoderState(),
      scratch: {
        mdct: new MdctScratch(),
        qmf: new QmfScratch(),
      },
    }
  }
}
