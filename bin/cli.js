#!/usr/bin/env node

/**
 * Carta1 Audio Codec - Command Line Interface
 *
 * Command-line tool for encoding and decoding ATRAC1 audio files.
 * Supports WAV to AEA encoding and AEA to WAV decoding with
 * real-time progress tracking and streaming processing.
 *
 * Usage:
 *   carta1 --encode input.wav output.aea
 *   carta1 --decode input.aea output.wav
 */

import { program } from 'commander'
import fs from 'fs'
import path from 'path'
import { performance } from 'perf_hooks'
import cliProgress from 'cli-progress'
import wav from 'wav'

import { AudioProcessor } from '../codec/io/processor.js'
import { AeaReader } from '../codec/io/readers.js'
import { deserializeFrame, AeaFile } from '../codec/io/serialization.js'
import {
  SAMPLE_RATE,
  SAMPLES_PER_FRAME,
  BITRATE_PER_CHANNEL,
  AEA_TITLE_SIZE,
  AEA_HEADER_SIZE,
  SOUND_UNIT_SIZE,
} from '../codec/core/constants.js'

/**
 * Format duration in seconds to MM:SS format
 *
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted time string (MM:SS)
 */
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${minutes.toString().padStart(2, '0')}:${secs
    .toString()
    .padStart(2, '0')}`
}

/**
 * Validate AEA title for length and ASCII encoding
 *
 * @param {string} title - Title to validate
 * @returns {Object} Validation result
 * @returns {boolean} returns.valid - Whether title is valid
 * @returns {string} [returns.error] - Error message if invalid
 */
function validateTitle(title) {
  if (!title) {
    return { valid: true }
  }

  // Check ASCII encoding
  for (let i = 0; i < title.length; i++) {
    const charCode = title.charCodeAt(i)
    if (charCode > 127) {
      return {
        valid: false,
        error: `Title contains non-ASCII character at position ${i}: "${title[i]}"`,
      }
    }
  }

  // Check length (AEA_TITLE_SIZE includes null terminator)
  const maxLength = AEA_TITLE_SIZE - 1
  if (title.length > maxLength) {
    return {
      valid: false,
      error: `Title is too long (${title.length} chars). Maximum allowed: ${maxLength} characters`,
    }
  }

  return { valid: true }
}

/**
 * Progress tracking utility for encoding/decoding operations
 *
 * Displays a progress bar with real-time performance metrics including:
 * - Frame processing progress
 * - Elapsed and remaining time estimates
 * - Real-time processing speed multiplier
 *
 * @class
 */
class ProgressTracker {
  /**
   * Create a progress tracker
   *
   * @param {number} frameCount - Total number of frames to process
   * @param {string} operation - Operation name ('Encoding' or 'Decoding')
   * @param {boolean} [quiet=false] - Suppress progress display
   */
  constructor(frameCount, operation, quiet = false) {
    this.totalFrames = frameCount
    this.quiet = quiet
    this.startTime = performance.now()
    this.frameCount = 0

    if (!quiet) {
      this.bar = new cliProgress.SingleBar(
        {
          autopadding: true,
          format: `${operation} |{bar}| {percentage}% | {value}/{total} frames | {elapsed}/{remaining} | RT: {speed}x`,
        },
        cliProgress.Presets.rect
      )
      this.bar.start(frameCount, 0)
    }
  }

  /**
   * Update progress with a new processed frame
   *
   * @param {number} sampleRate - Audio sample rate for RT speed calculation
   */
  update(sampleRate) {
    this.frameCount++
    if (!this.quiet) {
      const elapsed = (performance.now() - this.startTime) / 1000
      const audioProcessed = (this.frameCount * SAMPLES_PER_FRAME) / sampleRate
      const rtSpeed = elapsed > 0 ? audioProcessed / elapsed : 0
      const progress = this.frameCount / this.totalFrames
      const estimatedTotal = progress > 0 ? elapsed / progress : 0
      const remaining = Math.max(0, estimatedTotal - elapsed)

      this.bar.update(this.frameCount, {
        speed: rtSpeed.toFixed(1),
        elapsed: formatTime(elapsed),
        remaining: formatTime(remaining),
      })
    }
  }

  /**
   * Stop the progress bar display
   */
  stop() {
    if (!this.quiet && this.bar) {
      this.bar.stop()
    }
  }
}

/**
 * WAV file reader with streaming support
 *
 * Provides async iteration over WAV file frames for memory-efficient
 * processing of large audio files. Automatically handles:
 * - Multi-channel deinterleaving
 * - Bit depth conversion to float32
 * - Frame padding for the last partial frame
 *
 * @class
 */
class WavReader {
  /**
   * Create a WAV file reader
   *
   * @param {string} filePath - Path to the WAV file
   */
  constructor(filePath) {
    this.filePath = filePath
    this.channels = -1
    this.sampleRate = -1
    this.bitDepth = -1
    this.totalSamples = -1
    this.duration = -1
  }

  /**
   * Load WAV file metadata without reading audio data
   *
   * Parses the WAV header to extract format information and calculates
   * total duration based on file size.
   *
   * @returns {Promise<void>} Resolves when metadata is loaded
   * @throws {Error} If file cannot be read or has invalid format
   */
  async loadMetadata() {
    const stream = fs.createReadStream(this.filePath)
    const reader = new wav.Reader()
    stream.pipe(reader)

    return new Promise((resolve, reject) => {
      reader.on('format', (format) => {
        this.channels = format.channels
        this.sampleRate = format.sampleRate
        this.bitDepth = format.bitDepth

        const fileStats = fs.statSync(this.filePath)
        const wavHeaderSize = 44
        const dataSize = fileStats.size - wavHeaderSize
        const bytesPerSample = this.bitDepth / 8

        if (this.channels > 0 && bytesPerSample > 0) {
          const totalChannelSamples = dataSize / bytesPerSample
          this.totalSamples = Math.floor(totalChannelSamples / this.channels)
          this.duration = this.totalSamples / this.sampleRate
        }

        if (this.sampleRate !== SAMPLE_RATE) {
          console.log(
            `Warning: Input sample rate ${this.sampleRate}Hz, expected ${SAMPLE_RATE}Hz`
          )
        }

        stream.destroy()
        resolve()
      })
      reader.on('error', reject)
      stream.on('error', reject)
    })
  }

  /**
   * Async iterator for streaming WAV file frames
   *
   * @param {number} [frameSize=SAMPLES_PER_FRAME] - Samples per frame
   * @yields {Float32Array|Array<Float32Array>} Audio frame data
   *   - Mono: Float32Array of samples
   *   - Stereo: [left, right] Float32Arrays
   */
  async *[Symbol.asyncIterator](frameSize = SAMPLES_PER_FRAME) {
    const fileStream = fs.createReadStream(this.filePath)
    const wavReader = new wav.Reader()
    fileStream.pipe(wavReader)

    let pcmQueue = []
    let streamEnded = false
    let streamError = null
    let resolveDataPromise = null

    wavReader.on('data', (chunk) => {
      pcmQueue.push(chunk)
      if (resolveDataPromise) {
        resolveDataPromise()
        resolveDataPromise = null
      }
    })

    wavReader.on('end', () => {
      streamEnded = true
      if (resolveDataPromise) {
        resolveDataPromise()
        resolveDataPromise = null
      }
    })

    wavReader.on('error', (err) => {
      streamError = err
      if (resolveDataPromise) {
        resolveDataPromise()
        resolveDataPromise = null
      }
    })

    let buffer = Buffer.alloc(0)
    const bytesPerSample = this.bitDepth / 8
    const frameByteSize = frameSize * this.channels * bytesPerSample

    while (true) {
      if (streamError) throw streamError

      while (pcmQueue.length > 0) {
        buffer = Buffer.concat([buffer, ...pcmQueue])
        pcmQueue = []
      }

      while (buffer.length >= frameByteSize) {
        const frameBuffer = buffer.slice(0, frameByteSize)
        buffer = buffer.slice(frameByteSize)
        yield this._processFrameBuffer(frameBuffer, frameSize)
      }

      if (streamEnded && pcmQueue.length === 0) {
        if (buffer.length > 0) {
          const paddedFrame = Buffer.concat([
            buffer,
            Buffer.alloc(frameByteSize - buffer.length),
          ])
          yield this._processFrameBuffer(paddedFrame, frameSize)
        }
        break
      }

      if (!streamEnded) {
        await new Promise((resolve) => {
          resolveDataPromise = resolve
          if (pcmQueue.length > 0 || streamEnded) {
            resolveDataPromise = null
            resolve()
          }
        })
      }
    }
  }

  /**
   * Process raw PCM buffer into float32 frame data
   *
   * @private
   * @param {Buffer} frameBuffer - Raw PCM data
   * @param {number} frameSize - Number of samples per channel
   * @returns {Float32Array|Array<Float32Array>} Processed frame data
   */
  _processFrameBuffer(frameBuffer, frameSize) {
    if (this.channels === 1) {
      const frame = new Float32Array(frameSize)
      for (let i = 0; i < frameSize; i++) {
        frame[i] = this._sampleToFloat(frameBuffer, i * (this.bitDepth / 8))
      }
      return frame
    } else {
      const left = new Float32Array(frameSize)
      const right = new Float32Array(frameSize)
      for (let i = 0; i < frameSize; i++) {
        const offset = i * this.channels * (this.bitDepth / 8)
        left[i] = this._sampleToFloat(frameBuffer, offset)
        right[i] = this._sampleToFloat(frameBuffer, offset + this.bitDepth / 8)
      }
      return [left, right]
    }
  }

  /**
   * Convert PCM sample to normalized float32 value
   *
   * @private
   * @param {Buffer} buffer - PCM data buffer
   * @param {number} offset - Byte offset to sample
   * @returns {number} Normalized float value [-1.0, 1.0]
   */
  _sampleToFloat(buffer, offset) {
    if (this.bitDepth === 16) return buffer.readInt16LE(offset) / 32768.0
    if (this.bitDepth === 24) {
      let s =
        buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
      if (s > 0x7fffff) s -= 0x1000000
      return s / 8388608.0
    }
    if (this.bitDepth === 32) return buffer.readInt32LE(offset) / 2147483648.0
    return 0
  }
}

/**
 * Encode WAV file to ATRAC1 AEA format
 *
 * Performs streaming encoding with real-time progress tracking.
 * Automatically detects mono/stereo format and applies appropriate
 * compression settings.
 *
 * @param {string} inputFile - Path to input WAV file
 * @param {string} outputFile - Path to output AEA file
 * @param {Object} options - CLI options
 * @param {boolean} options.quiet - Suppress progress output
 * @param {string} [options.title] - Custom title for AEA file metadata
 * @returns {Promise<void>} Resolves when encoding is complete
 * @throws {Error} If input file has unsupported format
 */
async function encodeFile(inputFile, outputFile, options) {
  const reader = new WavReader(inputFile)
  await reader.loadMetadata()

  if (reader.channels !== 1 && reader.channels !== 2) {
    throw new Error(`Unsupported channel count: ${reader.channels}`)
  }

  const frameCount = Math.ceil(reader.totalSamples / SAMPLES_PER_FRAME)

  // Validate title if provided
  if (options.title) {
    const validation = validateTitle(options.title)
    if (!validation.valid) {
      throw new Error(validation.error)
    }
  }

  if (!options.quiet) {
    const bitrate = Math.round((BITRATE_PER_CHANNEL * reader.channels) / 1000)
    console.log(
      `${inputFile} (WAV ${reader.sampleRate}Hz ${
        reader.channels
      }ch ${formatTime(reader.duration)}) → ` +
        `${outputFile} (AEA ${bitrate}kbps)`
    )
  }

  const progress = new ProgressTracker(frameCount, 'Encoding', options.quiet)

  try {
    const onProgress = () => {
      progress.update(reader.sampleRate)
    }

    const encodedFrames = AudioProcessor.encodeStream(reader, {
      channelCount: reader.channels,
      onProgress,
    })

    const title = options.title || path.basename(outputFile, '.aea')
    const blob = await AudioProcessor.createAeaBlob(encodedFrames, {
      title,
      channelCount: reader.channels,
    })

    const buffer = await blob.arrayBuffer()
    await fs.promises.writeFile(outputFile, new Uint8Array(buffer))
  } finally {
    progress.stop()
  }
}

/**
 * Decode ATRAC1 AEA file to WAV format
 *
 * Performs streaming decoding with real-time progress tracking.
 * Reconstructs PCM audio from compressed ATRAC1 format.
 *
 * @param {string} inputFile - Path to input AEA file
 * @param {string} outputFile - Path to output WAV file
 * @param {Object} options - CLI options
 * @param {boolean} options.quiet - Suppress progress output
 * @returns {Promise<void>} Resolves when decoding is complete
 * @throws {Error} If input file is invalid or corrupted
 */
async function decodeFile(inputFile, outputFile, options) {
  const reader = new AeaReader(inputFile)
  await reader.loadMetadata()
  const { metadata } = reader

  const outputFrames = Math.floor(metadata.frameCount / metadata.channelCount)
  const duration = (outputFrames * SAMPLES_PER_FRAME) / SAMPLE_RATE

  if (!options.quiet) {
    const bitrate = Math.round(
      (BITRATE_PER_CHANNEL * metadata.channelCount) / 1000
    )
    console.log(
      `${inputFile} (AEA ${bitrate}kbps ${metadata.channelCount}ch ${formatTime(
        duration
      )}) → ` + `${outputFile} (WAV ${SAMPLE_RATE}Hz)`
    )
  }

  const progress = new ProgressTracker(outputFrames, 'Decoding', options.quiet)

  try {
    const onProgress = () => {
      progress.update(SAMPLE_RATE)
    }

    const decodedFrames = AudioProcessor.decodeStream(reader, {
      channelCount: metadata.channelCount,
      onProgress,
    })

    const pcmFrames = await AudioProcessor.collectFrames(decodedFrames)
    const wavBlob = AudioProcessor.createWavBlob(
      pcmFrames,
      metadata.channelCount,
      SAMPLE_RATE
    )

    const buffer = await wavBlob.arrayBuffer()
    await fs.promises.writeFile(outputFile, new Uint8Array(buffer))
  } finally {
    progress.stop()
  }
}

/**
 * Dump AEA file structure to JSON format
 *
 * Extracts and exports all metadata and frame information from an AEA file
 * for inspection and analysis. Includes header info, frame structure,
 * and statistical analysis.
 *
 * @param {string} inputFile - Path to input AEA file
 * @param {string} outputFile - Path to output JSON file
 * @param {Object} options - CLI options
 * @param {boolean} options.quiet - Suppress progress output
 * @returns {Promise<void>} Resolves when dump is complete
 * @throws {Error} If input file is invalid or cannot be read
 */
async function dumpFile(inputFile, outputFile, options) {
  const stats = fs.statSync(inputFile)

  if (!options.quiet) {
    console.log(`${inputFile} (AEA) → ${outputFile} (JSON)`)
  }

  const handle = await fs.promises.open(inputFile, 'r')
  const headerBuffer = Buffer.alloc(AEA_HEADER_SIZE)
  await handle.read(headerBuffer, 0, AEA_HEADER_SIZE, 0)

  let metadata
  try {
    metadata = AeaFile.parseHeader(headerBuffer)
  } catch (err) {
    throw new Error(`Invalid AEA header: ${err.message}`)
  }

  const frameCount = Math.floor(
    (stats.size - AEA_HEADER_SIZE) / SOUND_UNIT_SIZE
  )

  const dump = {
    file: {
      path: inputFile,
      size: stats.size,
      headerSize: AEA_HEADER_SIZE,
      dataSize: stats.size - AEA_HEADER_SIZE,
      expectedDataSize: frameCount * SOUND_UNIT_SIZE,
      sizeDifference:
        stats.size - AEA_HEADER_SIZE - frameCount * SOUND_UNIT_SIZE,
    },
    header: {
      magic: Array.from(headerBuffer.slice(0, 4))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' '),
      title: metadata.title,
      frameCount: metadata.frameCount,
      channelCount: metadata.channelCount,
      framesPerChannel: metadata.frameCount / metadata.channelCount,
      duration: ((metadata.frameCount / metadata.channelCount) * 512) / 44100,
    },
    frames: [],
  }

  const progress = new ProgressTracker(frameCount, 'Analyzing', options.quiet)

  try {
    let offset = AEA_HEADER_SIZE
    for (let i = 0; i < frameCount; i++) {
      const frameBuffer = Buffer.alloc(SOUND_UNIT_SIZE)
      await handle.read(frameBuffer, 0, SOUND_UNIT_SIZE, offset)

      try {
        const frame = deserializeFrame(frameBuffer)
        const frameInfo = {
          index: i,
          offset: offset,
          offsetHex: '0x' + offset.toString(16),
          nBfu: frame.nBfu,
          blockSizeMode: frame.blockSizeMode,
          scaleFactorIndices: Array.from(frame.scaleFactorIndices),
          wordLengthIndices: Array.from(frame.wordLengthIndices),
          hasNonZeroScaleFactors: frame.scaleFactorIndices.some((sf) => sf > 0),
          hasNonZeroWordLengths: frame.wordLengthIndices.some((wl) => wl > 0),
          hasCoefficients: frame.quantizedCoefficients.some(
            (coeffs) => coeffs && coeffs.some((c) => c !== 0)
          ),
        }

        // Include full coefficient data for first few frames only
        if (i < 3 || i === frameCount - 1) {
          frameInfo.quantizedCoefficients = frame.quantizedCoefficients.map(
            (coeffs) => (coeffs ? Array.from(coeffs) : null)
          )
        }

        dump.frames.push(frameInfo)
      } catch (err) {
        dump.frames.push({
          index: i,
          offset: offset,
          offsetHex: '0x' + offset.toString(16),
          error: err.message,
        })
      }

      progress.update(SAMPLE_RATE)
      offset += SOUND_UNIT_SIZE
    }
  } finally {
    progress.stop()
    await handle.close()
  }

  // Add summary statistics
  dump.summary = {
    totalFrames: frameCount,
    validFrames: dump.frames.filter((f) => !f.error).length,
    errorFrames: dump.frames.filter((f) => f.error).length,
    silentFrames: dump.frames.filter(
      (f) => !f.error && !f.hasNonZeroScaleFactors && !f.hasNonZeroWordLengths
    ).length,
    activeFrames: dump.frames.filter(
      (f) => !f.error && (f.hasNonZeroScaleFactors || f.hasNonZeroWordLengths)
    ).length,
  }

  const jsonOutput = JSON.stringify(dump, null, 2)
  await fs.promises.writeFile(outputFile, jsonOutput)
}

/**
 * Main CLI entry point
 *
 * Parses command line arguments and executes encoding, decoding,
 * or dump operations with error handling and validation.
 *
 * @returns {Promise<void>} Resolves when operation is complete
 */
async function main() {
  program
    .name('carta1')
    .description('ATRAC1 Audio Codec')
    .version('1.0.0')
    .option('-e, --encode', 'Encode WAV to AEA')
    .option('-d, --decode', 'Decode AEA to WAV')
    .option('-j, --json', 'Dump AEA file structure to JSON')
    .option('-q, --quiet', 'Suppress all output except errors')
    .option('-f, --force', 'Overwrite output file if it exists')
    .option(
      '-t, --title <title>',
      'Custom title for AEA file metadata (encoding only)'
    )
    .argument('<input>', 'Input file path')
    .argument('<output>', 'Output file path')
    .parse()

  const options = program.opts()
  const [inputFile, outputFile] = program.args

  // Validate operation mode
  const modes = [options.encode, options.decode, options.json].filter(Boolean)
  if (modes.length === 0) {
    console.error('Error: Must specify one of --encode, --decode, or --json')
    process.exit(1)
  }
  if (modes.length > 1) {
    console.error('Error: Cannot specify multiple operation modes')
    process.exit(1)
  }

  if (fs.existsSync(outputFile) && !options.force) {
    console.error(
      `Error: Output file '${outputFile}' already exists. Use --force to overwrite.`
    )
    process.exit(1)
  }

  try {
    if (options.encode) {
      await encodeFile(inputFile, outputFile, options)
    } else if (options.decode) {
      await decodeFile(inputFile, outputFile, options)
    } else if (options.json) {
      await dumpFile(inputFile, outputFile, options)
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Error: File not found - ${error.path}`)
    } else {
      console.error(`Error: ${error.message}`)
      if (!options.quiet) {
        console.error(error.stack)
      }
    }
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`An unhandled error occurred: ${error.message}`)
  console.error(error.stack)
  process.exit(1)
})
