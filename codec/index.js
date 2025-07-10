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
import { quantize, dequantize } from './coding/quantization.js'
import { qmfAnalysisStage, mdctStage } from './pipeline/encoder.js'
import { pipe } from './utils.js'
import { BufferPool } from './core/buffers.js'
import { EncoderOptions } from './core/options.js'
import { AudioProcessor } from './io/processor.js'
import { FFT } from './transforms/fft.js'
import {
  WORD_LENGTH_BITS,
  SPECS_PER_BFU,
  SCALE_FACTORS,
  BFU_START_LONG,
} from './core/constants.js'

export {
  pipe,
  encode,
  decode,
  qmfAnalysisStage,
  mdctStage,
  serializeFrame,
  deserializeFrame,
  quantize,
  dequantize,
  AeaFile,
  BufferPool,
  EncoderOptions,
  AudioProcessor,
  FFT,
  WORD_LENGTH_BITS,
  SPECS_PER_BFU,
  SCALE_FACTORS,
  BFU_START_LONG,
}
