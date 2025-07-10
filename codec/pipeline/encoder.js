/**
 * Carta1 Audio Codec - Encoding Pipeline
 *
 * The encoding pipeline transforms PCM audio samples into ATRAC1 compressed format
 * through a series of processing stages:
 *
 * 1. QMF Analysis: Splits audio into frequency bands using quadrature mirror filters
 * 2. Block Selection: Detects transients to choose appropriate transform block sizes
 * 3. MDCT Transform: Applies Modified Discrete Cosine Transform to frequency bands
 * 4. Quantization: Performs psychoacoustic analysis, bit allocation, and quantization
 *
 * Each stage is implemented as a functional pipeline component that can be composed
 * using the pipe utility. The pipeline maintains state through a shared context
 * containing buffer pools and encoding options.
 */

import { pipe, throwError } from '../utils.js'
import { qmfAnalysis } from '../transforms/qmf.js'
import { mdct64, mdct256, mdct512 } from '../transforms/mdct.js'
import {
  groupIntoBFUs,
  findScaleFactor,
  quantize,
} from '../coding/quantization.js'
import { allocateBits } from '../coding/bitallocation.js'
import { BufferPool } from '../core/buffers.js'
import { EncoderOptions } from '../core/options.js'
import {
  WORD_LENGTH_BITS,
  WINDOW_SHORT,
  FFT_SIZE_LOW,
  FFT_SIZE_MID,
  FFT_SIZE_HIGH,
  PSYMODEL_FFT_SIZE,
  MDCT_SIZE_SHORT,
  MDCT_SIZE_MID,
  MDCT_SIZE_LONG,
} from '../core/constants.js'
import { performFFT, detectTransient } from '../analysis/transient.js'
import { psychoAnalysis } from '../analysis/psychoacoustics.js'

/**
 * QMF Analysis Stage - Splits audio into frequency bands
 *
 * Performs two-stage QMF analysis to decompose the input signal into three bands:
 * - Low band (0-5.5kHz): processed at full resolution
 * - Mid band (5.5-11kHz): processed at half resolution
 * - High band (11-22kHz): processed at quarter resolution with delay compensation
 *
 * @param {Object} context - Pipeline context containing bufferPool
 * @param {BufferPool} context.bufferPool - Shared buffer pool for efficient memory management
 * @returns {Function} Stage function that processes PCM samples
 * @throws {Error} If bufferPool is not provided in context
 */
export function qmfAnalysisStage(context) {
  const bufferPool =
    context?.bufferPool ??
    throwError('qmfAnalysisStage: bufferPool is required')
  const delays = bufferPool.qmfDelays

  /**
   * Process PCM samples through QMF analysis
   * @param {Float32Array} pcmSamples - Input PCM samples
   * @returns {Object} Analysis result containing frequency bands
   * @returns {Array<Float32Array>} returns.bands - Three frequency bands [low, mid, high]
   */
  return (pcmSamples) => {
    const stage1 = qmfAnalysis(
      pcmSamples,
      delays.lowBand,
      bufferPool.qmfWorkBuffers
    )
    delays.lowBand = stage1.newDelay

    const stage2 = qmfAnalysis(
      stage1.lowBand,
      delays.midBand,
      bufferPool.qmfWorkBuffers
    )
    delays.midBand = stage2.newDelay

    const delayedHigh =
      bufferPool.qmfWorkBuffers.highBandDelay[stage1.highBand.length]
    delayedHigh.set(delays.highBand)
    delayedHigh.set(stage1.highBand, delays.highBand.length)

    const highBand = delayedHigh.slice(0, stage1.highBand.length)
    delays.highBand = delayedHigh.slice(stage1.highBand.length)

    return {
      bands: [stage2.lowBand, stage2.highBand, highBand],
    }
  }
}

/**
 * Block Selection Stage - Detects transients to choose transform block sizes
 *
 * Analyzes frequency bands using FFT and transient detection to determine
 * appropriate MDCT block sizes. Short blocks are used for transient signals
 * to prevent pre-echo artifacts, while long blocks provide better frequency
 * resolution for steady-state signals.
 *
 * @param {Object} context - Pipeline context containing bufferPool
 * @param {BufferPool} context.bufferPool - Shared buffer pool for efficient memory management
 * @returns {Function} Stage function that processes QMF analysis results
 * @throws {Error} If bufferPool is not provided in context
 */
export function blockSelectorStage(context) {
  const bufferPool =
    context?.bufferPool ??
    throwError('blockSelectorStage: bufferPool is required')
  const options =
    context?.options ?? throwError('blockSelectorStage: options is required')

  /**
   * Analyze frequency bands and determine block modes
   * @param {Object} input - QMF analysis results
   * @param {Array<Float32Array>} input.bands - Three frequency bands [low, mid, high]
   * @returns {Object} Block selection results
   * @returns {Array<Float32Array>} returns.bands - Original frequency bands
   * @returns {Array<number>} returns.blockModes - Block mode indices for each band
   */
  return (input) => {
    const { bands } = input
    const [lowBand, midBand, highBand] = bands

    const lowCoeffs = performFFT(lowBand, FFT_SIZE_LOW)
    const midCoeffs = performFFT(midBand, FFT_SIZE_MID)
    const highCoeffs = performFFT(highBand, FFT_SIZE_HIGH)

    const lowTransient = detectTransient(
      lowCoeffs,
      bufferPool.transientDetection.prevLowCoeffs,
      options.transientThresholdLow
    )
    const midTransient = detectTransient(
      midCoeffs,
      bufferPool.transientDetection.prevMidCoeffs,
      options.transientThresholdMid
    )
    const highTransient = detectTransient(
      highCoeffs,
      bufferPool.transientDetection.prevHighCoeffs,
      options.transientThresholdHigh
    )

    bufferPool.transientDetection.prevLowCoeffs = lowCoeffs
    bufferPool.transientDetection.prevMidCoeffs = midCoeffs
    bufferPool.transientDetection.prevHighCoeffs = highCoeffs

    return {
      bands,
      blockModes: [
        lowTransient ? 2 : 0,
        midTransient ? 2 : 0,
        highTransient ? 3 : 0,
      ],
    }
  }
}

/**
 * MDCT Transform Stage - Applies Modified Discrete Cosine Transform
 *
 * Transforms time-domain samples to frequency-domain coefficients using MDCT.
 * The transform size depends on the block mode determined by transient detection:
 * - Long blocks: 512/256 samples for better frequency resolution
 * - Short blocks: 64 samples for better time resolution
 *
 * Applies windowing and overlap-add processing to prevent blocking artifacts.
 * Mid and high bands are spectrally reversed to match ATRAC1 format.
 *
 * @param {Object} context - Pipeline context containing bufferPool
 * @param {BufferPool} context.bufferPool - Shared buffer pool for efficient memory management
 * @returns {Function} Stage function that processes block selection results
 * @throws {Error} If bufferPool is not provided in context
 */
export function mdctStage(context) {
  const bufferPool =
    context?.bufferPool ?? throwError('mdctStage: bufferPool is required')
  const overlapBuffers = bufferPool.mdctOverlap

  /**
   * Transform frequency bands using MDCT
   * @param {Object} input - Block selection results
   * @param {Array<Float32Array>} input.bands - Three frequency bands
   * @param {Array<number>} input.blockModes - Block mode indices for each band
   * @param {any} input.originalFrame - Original frame data (passed through)
   * @returns {Object} MDCT transform results
   * @returns {Array<Float32Array>} returns.bands - Original frequency bands
   * @returns {Float32Array} returns.coefficients - MDCT coefficients (512 samples)
   * @returns {Array<number>} returns.blockModes - Block mode indices
   * @returns {any} returns.originalFrame - Original frame data
   */
  return (input) => {
    const { bands, blockModes, originalFrame } = input

    const coefficients = new Float32Array(512)

    for (let band = 0; band < 3; band++) {
      const samples = bands[band]
      const bandSize = band === 2 ? 256 : 128
      const numBlocks = 1 << blockModes[band]
      const blockSize = numBlocks === 1 ? bandSize : 32

      const mdctFunc =
        numBlocks === 1 ? (band === 2 ? mdct512 : mdct256) : mdct64
      const mdctSize =
        numBlocks === 1
          ? band === 2
            ? MDCT_SIZE_LONG
            : MDCT_SIZE_MID
          : MDCT_SIZE_SHORT
      const windowStart = numBlocks === 1 ? (band === 2 ? 112 : 48) : 0

      const offset = band === 0 ? 0 : band === 1 ? 128 : 256

      for (let block = 0; block < numBlocks; block++) {
        const blockStart = block * blockSize
        const mdctInput = bufferPool.transformBuffers[mdctSize]
        mdctInput.fill(0)

        mdctInput.set(overlapBuffers[band], windowStart)

        for (let i = 0; i < 32; i++) {
          const tailValue = samples[blockStart + blockSize - 32 + i]
          overlapBuffers[band][i] = WINDOW_SHORT[i] * tailValue
          samples[blockStart + blockSize - 32 + i] =
            tailValue * WINDOW_SHORT[31 - i]
        }

        mdctInput.set(
          samples.subarray(blockStart, blockStart + blockSize),
          windowStart + 32
        )

        let spectrum = mdctFunc.transform(mdctInput, bufferPool.mdctBuffers)

        if (band > 0) {
          const reversed = bufferPool.reversalBuffers[spectrum.length]
          reversed.fill(0)
          for (let i = 0; i < spectrum.length; i++) {
            reversed[i] = spectrum[spectrum.length - 1 - i]
          }
          spectrum = reversed
        }

        coefficients.set(spectrum, offset + blockStart)
      }
    }

    return { bands, coefficients, blockModes, originalFrame }
  }
}

/**
 * Quantization Stage - Performs psychoacoustic analysis and quantization
 *
 * The final encoding stage that:
 * 1. Groups coefficients into Block Floating Units (BFUs)
 * 2. Performs psychoacoustic analysis to determine masking thresholds
 * 3. Allocates bits based on perceptual importance
 * 4. Quantizes coefficients using scale factors and word lengths
 *
 * Uses a perceptual model to ensure quantization noise remains below
 * the masking threshold, maximizing quality within the bit budget.
 *
 * @param {Object} context - Pipeline context containing bufferPool and options
 * @param {BufferPool} context.bufferPool - Shared buffer pool for efficient memory management
 * @param {EncoderOptions} context.options - Encoding configuration options
 * @returns {Function} Stage function that processes MDCT results
 * @throws {Error} If bufferPool or options are not provided in context
 */
export function quantizationStage(context) {
  const bufferPool =
    context?.bufferPool ??
    throwError('quantizationStage: bufferPool is required')
  const options =
    context?.options ?? throwError('quantizationStage: options is required')

  /**
   * Perform psychoacoustic analysis and quantization
   * @param {Object} input - MDCT transform results
   * @param {Float32Array} input.coefficients - MDCT coefficients
   * @param {Array<number>} input.blockModes - Block mode indices
   * @returns {Object} Quantization results ready for bitstream encoding
   * @returns {number} returns.nBfu - Number of active BFUs
   * @returns {Int32Array} returns.scaleFactorIndices - Scale factor indices for each BFU
   * @returns {Int32Array} returns.wordLengthIndices - Word length indices for each BFU
   * @returns {Array<Int32Array>} returns.quantizedCoefficients - Quantized coefficient data
   * @returns {Array<number>} returns.blockSizeMode - Block size mode for each band
   */
  return (input) => {
    const { coefficients, blockModes } = input

    const { bfuData, bfuSizes, bfuCount } = groupIntoBFUs(
      coefficients,
      blockModes,
      bufferPool.bfuData
    )

    const psychoResults = psychoAnalysis(
      coefficients,
      PSYMODEL_FFT_SIZE,
      bufferPool.psychoAnalysis,
      options.normalizationDb
    )
    const { bfuCount: selectedBfuCount, allocation } = allocateBits(
      psychoResults,
      bfuData,
      bfuSizes,
      bfuCount
    )

    const scaleFactorIndices = new Int32Array(selectedBfuCount)
    const quantizedCoefficients = []

    for (let bfu = 0; bfu < selectedBfuCount; bfu++) {
      const data = bfuData[bfu].subarray(0, bfuSizes[bfu])
      const wordLength = allocation[bfu]
      const bitsPerSample = WORD_LENGTH_BITS[wordLength]

      scaleFactorIndices[bfu] = findScaleFactor(data)
      const quantized = quantize(data, scaleFactorIndices[bfu], bitsPerSample)
      quantizedCoefficients.push(quantized)
    }

    return {
      nBfu: selectedBfuCount,
      scaleFactorIndices,
      wordLengthIndices: allocation.slice(0, selectedBfuCount),
      quantizedCoefficients,
      blockSizeMode: blockModes,
    }
  }
}

/**
 * Create ATRAC1 encoding pipeline
 *
 * Constructs a complete encoding pipeline that transforms PCM audio samples
 * into ATRAC1 compressed format. The pipeline processes audio through QMF
 * analysis, transient detection, MDCT transform, and psychoacoustic quantization.
 *
 * The returned function can be called repeatedly to encode audio frames,
 * maintaining state through the shared buffer pool for efficient processing.
 *
 * @param {EncoderOptions} [options=new EncoderOptions()] - Encoding configuration
 * @param {BufferPool} [bufferPool=new BufferPool()] - Shared buffer pool for state
 * @returns {Function} Encoding pipeline function that processes PCM samples
 *
 * @example
 * const encoder = encode(new EncoderOptions(), new BufferPool())
 * const result = encoder(pcmSamples) // Returns quantized ATRAC1 frame data
 */
export function encode(
  options = new EncoderOptions(),
  bufferPool = new BufferPool()
) {
  const context = { options, bufferPool }
  return pipe(
    context,
    qmfAnalysisStage,
    blockSelectorStage,
    mdctStage,
    quantizationStage
  )
}
