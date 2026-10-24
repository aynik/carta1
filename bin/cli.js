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
import { validateModes } from './options.js'
import { inspectAea } from '../codec/boundary/inspect.js'
import fs from 'fs'
import path from 'path'
import { performance } from 'perf_hooks'
import cliProgress from 'cli-progress'
import wav from 'wav'

import { pcmBytesToChannels } from '../codec/boundary/pcm.js'
import { AudioProcessor } from '../codec/boundary/processor.js'
import { AeaReader } from '../codec/boundary/reader.js'
import { validateAeaTitle } from '../codec/boundary/container.js'
import { EncoderOptions } from '../codec/core/options.js'
import {
  SAMPLE_RATE,
  SAMPLES_PER_FRAME,
  BITRATE_PER_CHANNEL,
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
 * Validate an AEA title for its fixed-width UTF-8 field.
 *
 * @param {string} title - Title to validate
 * @returns {Object} Validation result
 * @returns {boolean} returns.valid - Whether title is valid
 * @returns {string} [returns.error] - Error message if invalid
 */
function validateTitle(title) {
  return validateAeaTitle(title)
}

/**
 * Validate fixed block modes format and values
 *
 * @param {string} modes - Modes string in format "a,b,c"
 * @returns {Object} Validation result
 * @returns {boolean} returns.valid - Whether modes are valid
 * @returns {Array<number>} [returns.modes] - Parsed modes if valid
 * @returns {string} [returns.error] - Error message if invalid
 */

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
    const channels = pcmBytesToChannels(
      frameBuffer,
      this.bitDepth,
      this.channels,
      frameSize
    )
    return this.channels === 1 ? channels[0] : channels
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

  // Validate modes if provided
  let fixedBlockModes = null
  if (options.modes) {
    const validation = validateModes(options.modes)
    if (!validation.valid) {
      throw new Error(validation.error)
    }
    fixedBlockModes = validation.modes
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

    // Create encoder options with spectrum focus if provided
    const encoderOptions = new EncoderOptions()
    if (options.bias !== undefined) {
      encoderOptions.setValue('allocationBias', options.bias)
    }
    if (fixedBlockModes) {
      encoderOptions.setValue('fixedBlockModes', fixedBlockModes)
    }

    const encodedFrames = AudioProcessor.encodeStream(reader, {
      channelCount: reader.channels,
      onProgress,
      encoderOptions,
    })

    const title = options.title || path.basename(outputFile, '.aea')
    const blob = await AudioProcessor.createAeaBlob(encodedFrames, {
      title,
      channelCount: reader.channels,
      sampleCount: reader.totalSamples,
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
      primingSampleCount: metadata.primingSampleCount,
      sampleCount: metadata.sampleCount,
      onProgress,
    })

    const pcmFrames = await AudioProcessor.collectFrames(decodedFrames)
    const wavBlob = AudioProcessor.createPcmWaveBlob(
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
  const bytes = await fs.promises.readFile(inputFile)
  if (!options.quiet) console.log(`${inputFile} (AEA) → ${outputFile} (JSON)`)
  const frameCount = Math.floor(
    (bytes.length - AEA_HEADER_SIZE) / SOUND_UNIT_SIZE
  )
  const progress = new ProgressTracker(frameCount, 'Analyzing', options.quiet)
  try {
    const dump = inspectAea(bytes, inputFile, () =>
      progress.update(SAMPLE_RATE)
    )
    await fs.promises.writeFile(outputFile, JSON.stringify(dump, null, 2))
  } finally {
    progress.stop()
  }
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
  const { version } = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url))
  )
  program
    .name('carta1')
    .description('ATRAC1 Audio Codec')
    .version(version)
    .option('-e, --encode', 'Encode WAV to AEA')
    .option('-d, --decode', 'Decode AEA to WAV')
    .option('-j, --json', 'Dump AEA file structure to JSON')
    .option('-q, --quiet', 'Suppress all output except errors')
    .option('-f, --force', 'Overwrite output file if it exists')
    .option(
      '-t, --title <title>',
      'Custom UTF-8 title for AEA file metadata (encoding only)'
    )
    .option(
      '-b, --bias <value>',
      'Bit allocation bias (default: 1.0)',
      parseFloat
    )
    .option(
      '-m, --modes <modes>',
      'Fixed block modes [0/2],[0/2],[0/3] for low,mid,high bands (skips transient detection)'
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

export { validateModes }
