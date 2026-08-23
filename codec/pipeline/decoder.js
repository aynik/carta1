/**
 * Carta1 Audio Codec - Decoding Pipeline
 *
 * The frame pipeline reads as dequantization, then synthesis. Byte unpacking
 * remains the responsibility of deserializeFrame().
 */

import { dequantize } from '../dequantization.js'
import { BufferPool } from '../state.js'
import { synthesize } from '../synthesis/stage.js'
import { pipe } from '../utils.js'

/**
 * Create an ATRAC1 decoder.
 *
 * @param {BufferPool} [bufferPool=new BufferPool()]
 * @returns {Function}
 */
export function decode(bufferPool = new BufferPool()) {
  const context = { bufferPool }
  return pipe(context, dequantize, synthesize)
}
