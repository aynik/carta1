/**
 * Carta1 Audio Codec - Encoding Pipeline
 *
 * The frame pipeline reads as analysis, allocation, then quantization. Byte
 * packing remains the responsibility of serializeFrame().
 */

import { allocate } from '../allocation/stage.js'
import { analyze } from '../analysis/stage.js'
import { BufferPool } from '../core/buffers.js'
import { EncoderOptions } from '../core/options.js'
import { quantize } from '../quantization/stage.js'
import { pipe } from '../utils.js'

/**
 * Create an ATRAC1 encoder.
 *
 * @param {EncoderOptions} [options=new EncoderOptions()]
 * @param {BufferPool} [bufferPool=new BufferPool()]
 * @returns {Function}
 */
export function encode(
  options = new EncoderOptions(),
  bufferPool = new BufferPool()
) {
  const context = { options, bufferPool }
  return pipe(context, analyze, allocate, quantize)
}
