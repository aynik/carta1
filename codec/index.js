/**
 * Carta1 Audio Codec
 */

import { encode } from './pipeline/encoder.js'
import { decode } from './pipeline/decoder.js'
import {
  serializeFrame,
  deserializeFrame,
  AeaFile,
} from './io/serialization.js'
import { BufferPool } from './core/buffers.js'
import { EncoderOptions } from './core/options.js'
import { AudioProcessor } from './io/processor.js'
import { FFT } from './transforms/fft.js'

export {
  encode,
  decode,
  serializeFrame,
  deserializeFrame,
  AeaFile,
  BufferPool,
  EncoderOptions,
  AudioProcessor,
  FFT,
}
