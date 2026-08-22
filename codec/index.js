/**
 * Carta1 Audio Codec
 */

import { encode } from './pipeline/encoder.js'
import { decode } from './pipeline/decoder.js'
import { AeaFile } from './boundary/container.js'
import { deserializeFrame, serializeFrame } from './syntax/frame.js'
import { quantize, dequantize } from './quantization/spectrum.js'
import { analyzeBands as qmfAnalysisStage } from './analysis/bands.js'
import { transformSpectrum as mdctStage } from './analysis/spectrum.js'
import { pipe } from './utils.js'
import { BufferPool } from './state.js'
import { EncoderOptions } from './core/options.js'
import {
  AudioProcessor,
  decodeAeaPcm,
  encodeAeaPcm,
} from './boundary/stream.js'
import { FFT } from './signal/fft.js'
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
  decodeAeaPcm,
  encodeAeaPcm,
  FFT,
  WORD_LENGTH_BITS,
  SPECS_PER_BFU,
  SCALE_FACTORS,
  BFU_START_LONG,
}
