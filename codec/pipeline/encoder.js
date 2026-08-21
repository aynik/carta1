/**
 * Carta1 Audio Codec - Encoding Pipeline
 *
 * The encoding pipeline transforms PCM audio samples into ATRAC1 structured
 * syntax through three semantic stages:
 *
 * 1. Analysis: Builds the ATRAC1 spectrum and selects transform block modes
 * 2. Allocation: Groups the spectrum and distributes the available frame bits
 * 3. Quantization: Materializes the retained allocation as discrete symbols
 *
 * Byte packing remains the responsibility of serializeFrame(). Analysis expands
 * locally into QMF analysis, block selection, and spectral construction.
 */

import {
  pipe,
  throwError,
  reverseSpectrum,
  calculateBandOffset,
} from '../utils.js'
import { qmfAnalysis } from '../transforms/qmf.js'
import { mdct64, mdct256, mdct512 } from '../transforms/mdct.js'
import {
  groupIntoBFUs,
  quantize as quantizeCoefficient,
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
  MDCT_SIZE_SHORT,
  MDCT_SIZE_MID,
  MDCT_SIZE_LONG,
  MDCT_BAND_CONFIGS,
  MDCT_SHORT_BLOCK_SIZE,
  MDCT_OVERLAP_SIZE,
} from '../core/constants.js'
import { performFFT, detectTransient } from '../analysis/transient.js'

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
 * Select transform block sizes from transient analysis.
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
export function selectBlocks(context) {
  const bufferPool =
    context?.bufferPool ?? throwError('selectBlocks: bufferPool is required')
  const options =
    context?.options ?? throwError('selectBlocks: options is required')

  /**
   * Analyze frequency bands and determine block modes
   * @param {Object} input - QMF analysis results
   * @param {Array<Float32Array>} input.bands - Three frequency bands [low, mid, high]
   * @returns {Object} Block selection results
   * @returns {Array<Float32Array>} returns.bands - Original frequency bands
   * @returns {Array<number>} returns.blockModes - Block modes for each band
   */
  return (input) => {
    const { bands } = input

    // Use fixed block modes if provided, otherwise do transient detection
    let blockModes
    if (options.fixedBlockModes) {
      blockModes = options.fixedBlockModes
    } else {
      const fftSizes = [FFT_SIZE_LOW, FFT_SIZE_MID, FFT_SIZE_HIGH]
      blockModes = bands.map((bandSamples, bandIndex) => {
        const coeffs = performFFT(bandSamples, fftSizes[bandIndex])
        const transient = detectTransient(
          coeffs,
          bufferPool.transientDetection[bandIndex],
          options.transientThresholdLow
        )
        bufferPool.transientDetection[bandIndex] = coeffs
        return transient * Math.max(bandIndex + 1, 2)
      })
    }

    return {
      bands,
      blockModes,
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

  // Transform function mapping for each band
  const TRANSFORM_FUNCS = [mdct256, mdct256, mdct512]

  /**
   * Transform a single frequency band using MDCT.
   * @param {Float32Array} samples
   * @param {number} bandIndex
   * @param {number} blockMode
   * @param {Float32Array} overlapBuffer
   * @param {Object} bufferPool
   * @returns {Float32Array}
   */
  function transformBand(
    samples,
    bandIndex,
    blockMode,
    overlapBuffer,
    bufferPool
  ) {
    const config = MDCT_BAND_CONFIGS[bandIndex]
    const transformFunc = TRANSFORM_FUNCS[bandIndex]
    const isLongBlock = blockMode === 0

    if (isLongBlock) {
      return transformLongBlock(
        samples,
        bandIndex,
        config,
        transformFunc,
        overlapBuffer,
        bufferPool
      )
    } else {
      return transformShortBlocks(
        samples,
        bandIndex,
        config,
        overlapBuffer,
        bufferPool
      )
    }
  }

  /**
   * Transform using long block (better frequency resolution).
   * @param {Float32Array} samples
   * @param {number} bandIndex
   * @param {Object} config
   * @param {Object} transformFunc
   * @param {Float32Array} overlapBuffer
   * @param {Object} bufferPool
   * @returns {Float32Array}
   */
  function transformLongBlock(
    samples,
    bandIndex,
    config,
    transformFunc,
    overlapBuffer,
    bufferPool
  ) {
    const mdctSize = bandIndex === 2 ? MDCT_SIZE_LONG : MDCT_SIZE_MID
    const mdctInput = bufferPool.transformBuffers[mdctSize]
    mdctInput.fill(0)

    // Apply overlap from previous frame
    mdctInput.set(overlapBuffer, config.windowStart)

    // Window and save tail for next frame
    applyTailWindowing(samples, overlapBuffer, config.size)

    // Add current frame samples
    mdctInput.set(samples, config.windowStart + MDCT_OVERLAP_SIZE)

    // Transform
    let spectrum = transformFunc.transform(mdctInput, bufferPool.mdctBuffers)

    // Apply spectral reversal for mid/high bands
    if (bandIndex > 0) {
      spectrum = reverseSpectrum(spectrum, bufferPool.reversalBuffers)
    }

    return spectrum
  }

  /**
   * Transform using short blocks (better time resolution for transients).
   * @param {Float32Array} samples
   * @param {number} bandIndex
   * @param {Object} config
   * @param {Float32Array} overlapBuffer
   * @param {Object} bufferPool
   * @returns {Float32Array}
   */
  function transformShortBlocks(
    samples,
    bandIndex,
    config,
    overlapBuffer,
    bufferPool
  ) {
    const numBlocks = 1 << (config.size === 256 ? 3 : 2) // 8 for band 2, 4 for bands 0-1
    const output = new Float32Array(config.size)

    for (let block = 0; block < numBlocks; block++) {
      const blockStart = block * MDCT_SHORT_BLOCK_SIZE
      const blockSamples = samples.subarray(
        blockStart,
        blockStart + MDCT_SHORT_BLOCK_SIZE
      )

      // Prepare MDCT input
      const mdctInput = bufferPool.transformBuffers[MDCT_SIZE_SHORT]
      mdctInput.fill(0)
      mdctInput.set(overlapBuffer, 0)

      // Window and save tail
      applyTailWindowing(blockSamples, overlapBuffer, MDCT_SHORT_BLOCK_SIZE)
      mdctInput.set(blockSamples, MDCT_OVERLAP_SIZE)

      // Transform
      let spectrum = mdct64.transform(mdctInput, bufferPool.mdctBuffers)

      // Apply spectral reversal for mid/high bands
      if (bandIndex > 0) {
        spectrum = reverseSpectrum(spectrum, bufferPool.reversalBuffers)
      }

      output.set(spectrum, blockStart)
    }

    return output
  }

  function applyTailWindowing(samples, overlapBuffer, blockSize) {
    const tailStart = blockSize - MDCT_OVERLAP_SIZE
    for (let i = 0; i < MDCT_OVERLAP_SIZE; i++) {
      const tailValue = samples[tailStart + i]
      overlapBuffer[i] = WINDOW_SHORT[i] * tailValue
      samples[tailStart + i] = tailValue * WINDOW_SHORT[31 - i]
    }
  }

  /**
   * Transform frequency bands using MDCT
   * @param {Object} input - Block selection results
   * @param {Array<Float32Array>} input.bands - Three frequency bands
   * @param {Array<number>} input.blockModes - Block modes for each band
   * @param {any} input.originalFrame - Original frame data (passed through)
   * @returns {Object} MDCT transform results
   * @returns {Array<Float32Array>} returns.bands - Original frequency bands
   * @returns {Float32Array} returns.coefficients - MDCT coefficients (512 samples)
   * @returns {Array<number>} returns.blockModes - Block modes
   * @returns {any} returns.originalFrame - Original frame data
   */
  return (input) => {
    const { bands, blockModes, originalFrame } = input
    const coefficients = new Float32Array(512)

    bands.forEach((bandSamples, bandIndex) => {
      const transformed = transformBand(
        bandSamples,
        bandIndex,
        blockModes[bandIndex],
        overlapBuffers[bandIndex],
        bufferPool
      )

      const offset = calculateBandOffset(bandIndex)
      coefficients.set(transformed, offset)
    })

    return { bands, coefficients, blockModes, originalFrame }
  }
}

/**
 * Allocate the frame budget across block floating units.
 *
 * @param {Object} context
 * @param {EncoderOptions} context.options
 * @returns {Function}
 */
export function allocate(context) {
  const options =
    context?.options ?? throwError('allocate: options is required')

  /**
   * @param {Object} input
   * @param {Float32Array} input.coefficients
   * @param {Array<number>} input.blockModes
   * @returns {Object}
   * @returns {Array<Float32Array>} returns.bfuData
   * @returns {Array<number>} returns.bfuSizes
   * @returns {number} returns.nBfu
   * @returns {Int32Array} returns.scaleFactorIndices
   * @returns {Int32Array} returns.wordLengthIndices
   * @returns {Array<number>} returns.blockModes
   */
  return (input) => {
    const { coefficients, blockModes } = input

    const { bfuData, bfuSizes, bfuCount } = groupIntoBFUs(
      coefficients,
      blockModes
    )

    const {
      bfuCount: selectedBfuCount,
      allocation,
      scaleFactorIndices,
    } = allocateBits(bfuData, bfuSizes, bfuCount, options.allocationBias)

    const wordLengthIndices = allocation.slice(0, selectedBfuCount)

    return {
      bfuData,
      bfuSizes,
      nBfu: selectedBfuCount,
      scaleFactorIndices: scaleFactorIndices.slice(0, selectedBfuCount),
      wordLengthIndices,
      blockModes,
    }
  }
}

/**
 * Materialize the retained allocation as quantized ATRAC1 symbols.
 *
 * @returns {Function}
 */
export function quantize() {
  /**
   * @param {Object} input
   * @param {Array<Float32Array>} input.bfuData
   * @param {Array<number>} input.bfuSizes
   * @param {number} input.nBfu
   * @param {Int32Array} input.scaleFactorIndices
   * @param {Int32Array} input.wordLengthIndices
   * @param {Array<number>} input.blockModes
   * @returns {Object}
   * @returns {number} returns.nBfu
   * @returns {Int32Array} returns.scaleFactorIndices
   * @returns {Int32Array} returns.wordLengthIndices
   * @returns {Array<Int32Array>} returns.quantizedCoefficients
   * @returns {Array<number>} returns.blockModes
   */
  return (input) => {
    const {
      bfuData,
      bfuSizes,
      nBfu,
      scaleFactorIndices,
      wordLengthIndices,
      blockModes,
    } = input
    const quantizedCoefficients = []

    for (let bfu = 0; bfu < nBfu; bfu++) {
      const data = bfuData[bfu].subarray(0, bfuSizes[bfu])
      const wordLength = wordLengthIndices[bfu]
      const bitsPerSample = WORD_LENGTH_BITS[wordLength]
      const quantized = quantizeCoefficient(
        data,
        scaleFactorIndices[bfu],
        bitsPerSample
      )
      quantizedCoefficients.push(quantized)
    }

    return {
      nBfu,
      scaleFactorIndices,
      wordLengthIndices,
      quantizedCoefficients,
      blockModes,
    }
  }
}

/**
 * Analyze a PCM frame in the ATRAC1 signal domain.
 *
 * @param {Object} context
 * @param {BufferPool} context.bufferPool
 * @param {EncoderOptions} context.options
 * @returns {Function}
 */
export function analyze(context) {
  const analyzeFrame = pipe(context, qmfAnalysisStage, selectBlocks, mdctStage)

  /**
   * @param {Float32Array} pcmSamples
   * @returns {{coefficients: Float32Array, blockModes: Array<number>}}
   */
  return (pcmSamples) => {
    const { coefficients, blockModes } = analyzeFrame(pcmSamples)
    return { coefficients, blockModes }
  }
}

/**
 * Create an ATRAC1 encoder.
 *
 * The returned function encodes consecutive PCM frames while the supplied
 * buffer pool retains the analysis state between calls.
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
