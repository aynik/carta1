/**
 * Carta1 synthesis stage.
 */

import { pipe } from '../utils.js'
import { synthesizeSpectrum } from './bands.js'
import { synthesizePcm } from './pcm.js'

/**
 * Synthesize PCM from the dequantized ATRAC1 spectrum.
 *
 * @param {object} context
 * @returns {Function}
 */
export function synthesize(context) {
  return pipe(context, synthesizeSpectrum, synthesizePcm)
}
