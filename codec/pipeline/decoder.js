/**
 * Carta1 Audio Codec - Decoding Pipeline
 *
 * The decoding pipeline transforms ATRAC1 compressed format back into PCM audio samples
 * through a series of processing stages:
 *
 * 1. Dequantization: Reconstructs MDCT coefficients from quantized data using scale factors
 * 2. Inverse MDCT: Applies Inverse Modified Discrete Cosine Transform to frequency bands
 * 3. QMF Synthesis: Reconstructs full-spectrum audio using quadrature mirror filters
 *
 * Each stage is implemented as a functional pipeline component that can be composed
 * using the pipe utility. The pipeline maintains state through a shared context
 * containing buffer pools and decoding options.
 */

import { pipe, throwError } from '../utils.js'
import { qmfSynthesis } from '../transforms/qmf.js'
import { imdct64, imdct256, imdct512, overlapAdd } from '../transforms/mdct.js'
import { dequantize } from '../coding/quantization.js'
import { BufferPool } from '../core/buffers.js'
import {
  BFU_BAND_BOUNDARIES,
  BFU_START_LONG,
  BFU_START_SHORT,
  WORD_LENGTH_BITS,
  WINDOW_SHORT,
  MDCT_SIZE_LONG,
} from '../core/constants.js'

/**
 * Dequantization Stage - Reconstructs MDCT coefficients from quantized data
 *
 * Reverses the quantization process by:
 * - Reconstructing coefficient values using scale factors and word lengths
 * - Organizing coefficients back into Block Floating Units (BFUs)
 * - Preparing coefficient array for inverse MDCT transform
 *
 * Uses the same BFU organization as the encoder but reconstructs the original
 * coefficient values from the quantized representation.
 *
 * @returns {Function} Stage function that processes quantized frame data
 * @throws {Error} If bufferPool is not provided in context
 */
function dequantizationStage() {
  /**
   * Reconstruct MDCT coefficients from quantized data
   * @param {Object} frameData - Quantized frame data
   * @param {number} frameData.nBfu - Number of active BFUs
   * @param {Int32Array} frameData.scaleFactorIndices - Scale factor indices for each BFU
   * @param {Int32Array} frameData.wordLengthIndices - Word length indices for each BFU
   * @param {Array<Int32Array>} frameData.quantizedCoefficients - Quantized coefficient data
   * @param {Array<number>} frameData.blockSizeMode - Block size mode for each band
   * @returns {Array} Dequantization results [coefficients, blockModes]
   * @returns {Float32Array} returns[0] - Reconstructed MDCT coefficients (512 samples)
   * @returns {Array<number>} returns[1] - Block mode indices for each band
   */
  return (frameData) => {
    const coefficients = new Float32Array(512)
    const {
      nBfu,
      scaleFactorIndices,
      wordLengthIndices,
      quantizedCoefficients,
      blockSizeMode,
    } = frameData

    for (let bfu = 0; bfu < nBfu; bfu++) {
      const bitsPerSample = WORD_LENGTH_BITS[wordLengthIndices[bfu]]

      let band = 0
      if (bfu >= BFU_BAND_BOUNDARIES[0]) band = 1
      if (bfu >= BFU_BAND_BOUNDARIES[1]) band = 2

      const isLongBlock = blockSizeMode[band] === 0
      const position = isLongBlock ? BFU_START_LONG[bfu] : BFU_START_SHORT[bfu]

      if (bitsPerSample > 0) {
        const quantized = quantizedCoefficients[bfu]
        const dequantized = dequantize(
          quantized,
          scaleFactorIndices[bfu],
          bitsPerSample
        )
        coefficients.set(dequantized, position)
      }
    }

    return [coefficients, blockSizeMode]
  }
}

/**
 * Inverse MDCT Stage - Transforms frequency coefficients back to time domain
 *
 * Applies Inverse Modified Discrete Cosine Transform to reconstruct time-domain
 * samples from frequency coefficients. The transform size depends on block modes:
 * - Long blocks: 512/256 samples for steady-state signals
 * - Short blocks: 64 samples for transient signals
 *
 * Applies windowing and overlap-add processing to prevent blocking artifacts.
 * Mid and high bands are spectrally unreversed from ATRAC1 format.
 *
 * @param {Object} context - Pipeline context containing bufferPool
 * @param {BufferPool} context.bufferPool - Shared buffer pool for efficient memory management
 * @returns {Function} Stage function that processes dequantization results
 * @throws {Error} If bufferPool is not provided in context
 */
function imdctStage(context) {
  const bufferPool =
    context?.bufferPool ?? throwError('imdctStage: bufferPool is required')
  const overlapBuffers = bufferPool.imdctOverlap

  /**
   * Transform coefficients back to time domain using inverse MDCT
   * @param {Array} input - Dequantization results
   * @param {Float32Array} input[0] - MDCT coefficients (512 samples)
   * @param {Array<number>} input[1] - Block mode indices for each band
   * @returns {Array<Float32Array>} Three reconstructed frequency bands [low, mid, high]
   */
  return (input) => {
    const [coefficients, blockModes] = input
    const bands = []

    const bandCoeffs = [
      coefficients.subarray(0, 128),
      coefficients.subarray(128, 256),
      coefficients.subarray(256, 512),
    ]

    for (let band = 0; band < 3; band++) {
      const bandSize = band === 2 ? 256 : 128
      const numBlocks = 1 << blockModes[band]
      const blockSize = numBlocks === 1 ? bandSize : 32

      const imdctFunc =
        numBlocks === 1 ? (band === 2 ? imdct512 : imdct256) : imdct64

      const invBuf = bufferPool.transformBuffers[MDCT_SIZE_LONG]
      invBuf.fill(0)
      const dstBuf = overlapBuffers[band]
      const prevBuf = dstBuf.slice(bandSize * 2 - 16, bandSize * 2)

      let start = 0
      let pos = 0

      for (let block = 0; block < numBlocks; block++) {
        let blockSpecs = bandCoeffs[band].slice(pos, pos + blockSize)

        // Reverse spectral reversal for mid and high bands
        if (band > 0) {
          const reversed = bufferPool.reversalBuffers[blockSpecs.length]
          for (let i = 0; i < blockSpecs.length; i++) {
            reversed[i] = blockSpecs[blockSpecs.length - 1 - i]
          }
          blockSpecs = reversed
        }

        const inv = imdctFunc.transform(blockSpecs, bufferPool.mdctBuffers)
        const invStart = inv.length / 4

        for (let i = 0; i < blockSize; i++) {
          invBuf[start + i] = inv[invStart + i]
        }

        const dstPart = overlapAdd(
          prevBuf.slice(0, 16),
          invBuf.slice(start, start + 16),
          WINDOW_SHORT
        )

        dstBuf.set(dstPart, start)

        for (let i = 0; i < 16; i++) {
          prevBuf[i] = invBuf[start + 16 + i]
        }

        start += blockSize
        pos += blockSize
      }

      if (numBlocks === 1) {
        const copyLen = band === 2 ? 240 : 112
        for (let i = 0; i < copyLen; i++) {
          dstBuf[32 + i] = invBuf[16 + i]
        }
      }

      for (let i = 0; i < 16; i++) {
        dstBuf[bandSize * 2 - 16 + i] = invBuf[bandSize - 16 + i]
      }

      bands.push(dstBuf.slice(0, bandSize))
    }

    return bands
  }
}

/**
 * QMF Synthesis Stage - Reconstructs full-spectrum audio from frequency bands
 *
 * Performs two-stage QMF synthesis to reconstruct the full-spectrum signal
 * from three frequency bands:
 * - Low band (0-5.5kHz): processed at full resolution
 * - Mid band (5.5-11kHz): processed at half resolution
 * - High band (11-22kHz): processed at quarter resolution with delay compensation
 *
 * This is the inverse operation of the QMF analysis performed during encoding,
 * combining the separate frequency bands back into a single wideband signal.
 *
 * @param {Object} context - Pipeline context containing bufferPool
 * @param {BufferPool} context.bufferPool - Shared buffer pool for efficient memory management
 * @returns {Function} Stage function that processes inverse MDCT results
 * @throws {Error} If bufferPool is not provided in context
 */
function qmfSynthesisStage(context) {
  const bufferPool =
    context?.bufferPool ??
    throwError('qmfSynthesisStage: bufferPool is required')
  const delays = bufferPool.qmfDelays

  /**
   * Reconstruct full-spectrum PCM samples from frequency bands
   * @param {Array<Float32Array>} bands - Three frequency bands [low, mid, high]
   * @returns {Float32Array} Reconstructed PCM samples
   */
  return (bands) => {
    // Apply high band delay compensation
    const delayedHigh = bufferPool.qmfWorkBuffers.highBandDelay[bands[2].length]
    delayedHigh.set(delays.highBand)
    delayedHigh.set(bands[2])

    const highBand = delayedHigh.slice(0, bands[0].length * 2)
    delays.highBand = delayedHigh.slice(bands[0].length * 2)

    // Second stage synthesis: combine low and mid bands
    const stage2 = qmfSynthesis(
      bands[0],
      bands[1],
      delays.midBand,
      bufferPool.qmfWorkBuffers
    )
    delays.midBand = stage2.newDelay

    // First stage synthesis: combine result with high band
    const stage1 = qmfSynthesis(
      stage2.output,
      highBand,
      delays.lowBand,
      bufferPool.qmfWorkBuffers
    )
    delays.lowBand = stage1.newDelay

    return stage1.output
  }
}

/**
 * Create ATRAC1 decoding pipeline
 *
 * Constructs a complete decoding pipeline that transforms ATRAC1 compressed format
 * back into PCM audio samples. The pipeline processes quantized data through
 * dequantization, inverse MDCT transform, and QMF synthesis.
 *
 * The returned function can be called repeatedly to decode audio frames,
 * maintaining state through the shared buffer pool for efficient processing.
 *
 * @param {BufferPool} [bufferPool=new BufferPool()] - Shared buffer pool for state
 * @returns {Function} Decoding pipeline function that processes quantized frame data
 *
 * @example
 * const decoder = decode(new BufferPool())
 * const result = decoder(quantizedFrame) // Returns reconstructed PCM samples
 */
export function decode(bufferPool = new BufferPool()) {
  const context = { bufferPool }
  return pipe(context, dequantizationStage, imdctStage, qmfSynthesisStage)
}
