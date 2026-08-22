/**
 * Carta1 synthesis stage.
 */

import { pipe } from '../utils.js'
import { synthesizeSpectrum } from './bands.js'
import { synthesizePcm } from './pcm.js'

/**
 * @callback SynthesizeFrame
 * @param {import('../dequantization.js').DequantizedFrame} frame
 * @returns {Float32Array}
 */

/**
 * Synthesize PCM from the dequantized ATRAC1 spectrum.
 *
 * @param {{bufferPool: import('../state.js').BufferPool}} context
 * @returns {SynthesizeFrame}
 */
export function synthesize(context) {
  return pipe(context, synthesizeSpectrum, synthesizePcm)
}
