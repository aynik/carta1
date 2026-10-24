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

import fs from 'fs'
import path from 'path'

import { AudioProcessor } from '../codec/boundary/processor.js'
import { AeaReader } from '../codec/boundary/reader.js'
import { AeaFile, validateAeaTitle } from '../codec/boundary/container.js'
import { createPcmWaveHeader, interleavePcm16 } from '../codec/boundary/pcm.js'
import { serializeFrame } from '../codec/syntax/frame.js'
import { EncoderOptions } from '../codec/core/options.js'
import {
  SAMPLE_RATE,
  SAMPLES_PER_FRAME,
  BITRATE_PER_CHANNEL,
} from '../codec/core/constants.js'

const LITTLE_ENDIAN_PCM = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

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
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateTitle(title) {
  return validateAeaTitle(title)
}

/**
 * Validate fixed block modes format and values
 *
 * @param {string} modes - Modes string in format "a,b,c"
 * @returns {{valid: boolean, modes?: Array<number>, error?: string}} Validation result
 */
export function validateModes(modes) {
  if (!modes) {
    return { valid: true }
  }

  const parts = modes.split(',')
  if (parts.length !== 3) {
    return {
      valid: false,
      error: `Modes must have exactly 3 values separated by commas, got ${parts.length}`,
    }
  }

  const parsedModes = []
  const validValues = [
    [0, 2], // Position 1: 0 or 2
    [0, 2], // Position 2: 0 or 2
    [0, 3], // Position 3: 0 or 3
  ]

  for (let i = 0; i < 3; i++) {
    const mode = parseInt(parts[i], 10)
    if (isNaN(mode)) {
      return {
        valid: false,
        error: `Mode at position ${i + 1} is not a number: "${parts[i]}"`,
      }
    }

    if (!validValues[i].includes(mode)) {
      return {
        valid: false,
        error: `Mode at position ${i + 1} must be ${validValues[i].join(' or ')}, got ${mode}`,
      }
    }

    parsedModes.push(mode)
  }

  return { valid: true, modes: parsedModes }
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
   * Create a progress tracker.
   *
   * @param {number} frameCount - Total number of frames to process
   * @param {string} operation - Operation name ('Encoding' or 'Decoding')
   * @param {boolean} [quiet=false] - Suppress progress display
   */
  constructor(frameCount, operation, quiet = false) {
    this.totalFrames = frameCount
    this.operation = operation
    this.enabled = !quiet && process.stderr.isTTY
    this.startTime = performance.now()
    this.lastRender = -Infinity
    this.frameCount = 0
    this.render()
  }

  /**
   * Update progress with a new processed frame.
   *
   * @param {number} sampleRate - Audio sample rate for RT speed calculation
   */
  update(sampleRate) {
    this.frameCount++
    this.sampleRate = sampleRate
    this.render()
  }

  /**
   * Render a throttled progress update on an interactive terminal.
   *
   * @param {boolean} [force=false] - Render even inside the throttle interval
   */
  render(force = false) {
    if (!this.enabled) return
    const now = performance.now()
    if (!force && now - this.lastRender < 100) return
    this.lastRender = now
    const elapsed = (now - this.startTime) / 1000
    const fraction =
      this.totalFrames > 0 ? Math.min(1, this.frameCount / this.totalFrames) : 1
    const filled = Math.floor(fraction * 24)
    const remaining = fraction > 0 ? elapsed * (1 / fraction - 1) : 0
    const speed =
      elapsed > 0
        ? (this.frameCount * SAMPLES_PER_FRAME) /
          (this.sampleRate || SAMPLE_RATE) /
          elapsed
        : 0
    process.stderr.write(
      `\r\x1b[2K${this.operation} |${'█'.repeat(filled)}${'░'.repeat(24 - filled)}| ${Math.floor(fraction * 100)}% | ${this.frameCount}/${this.totalFrames} frames | ${formatTime(elapsed)}/${formatTime(remaining)} | RT: ${speed.toFixed(1)}x`
    )
  }

  /** Stop the progress display after rendering the final frame count. */
  stop() {
    this.render(true)
    if (this.enabled) process.stderr.write('\n')
  }
}

/**
 * Convert PCM sample to normalized float32 value
 *
 * @private
 * @param {Buffer} buffer - PCM data buffer
 * @param {i32} offset - Byte offset to sample
 * @param {number} bitDepth - PCM sample width in bits
 * @returns {number} Normalized float value [-1.0, 1.0]
 */
function readPcmSample(buffer, offset, bitDepth) {
  if (bitDepth === 16) return buffer.readInt16LE(offset) / 32768.0
  if (bitDepth === 24) {
    let s =
      buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16)
    if (s > 0x7fffff) s -= 0x1000000
    return s / 8388608.0
  }
  if (bitDepth === 32) return buffer.readInt32LE(offset) / 2147483648.0
  return 0
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
    const handle = await fs.promises.open(this.filePath, 'r')
    try {
      const header = Buffer.alloc(12)
      await handle.read(header, 0, 12, 0)
      if (
        header.toString('ascii', 0, 4) !== 'RIFF' ||
        header.toString('ascii', 8, 12) !== 'WAVE'
      )
        throw new Error('Invalid RIFF/WAVE input')
      const size = (await handle.stat()).size
      let format = false
      let data = false
      for (let offset = 12; offset + 8 <= size;) {
        const chunk = Buffer.alloc(8)
        await handle.read(chunk, 0, 8, offset)
        const length = chunk.readUInt32LE(4)
        if (offset + 8 + length > size) throw new Error('Truncated WAV chunk')
        const name = chunk.toString('ascii', 0, 4)
        if (name === 'fmt ') {
          if (length < 16) throw new Error('Invalid WAV format')
          const bytes = Buffer.alloc(16)
          await handle.read(bytes, 0, 16, offset + 8)
          if (bytes.readUInt16LE(0) !== 1)
            throw new Error('Expected integer PCM WAV')
          this.channels = bytes.readUInt16LE(2)
          this.sampleRate = bytes.readUInt32LE(4)
          this.bitDepth = bytes.readUInt16LE(14)
          format = true
        } else if (name === 'data') {
          this.dataOffset = offset + 8
          this.dataSize = length
          data = true
        }
        if (format && data) break
        offset += 8 + length + (length & 1)
      }
      if (
        !format ||
        !data ||
        ![16, 24, 32].includes(this.bitDepth) ||
        ![1, 2].includes(this.channels)
      )
        throw new Error('Expected mono/stereo 16/24/32-bit PCM WAV')
      const stride = (this.channels * this.bitDepth) / 8
      if (this.dataSize % stride !== 0) throw new Error('Incomplete WAV sample')
      this.totalSamples = this.dataSize / stride
      this.duration = this.totalSamples / this.sampleRate
      if (this.sampleRate !== SAMPLE_RATE)
        console.log(
          `Warning: Input sample rate ${this.sampleRate}Hz, expected ${SAMPLE_RATE}Hz`
        )
    } finally {
      await handle.close()
    }
  }

  /**
   * Async iterator for streaming WAV file frames.
   *
   * Reads bounded PCM batches, yielding one frame at a time and zero-padding
   * a final partial frame.
   * Channel state belongs to the downstream encoder closures.
   *
   * @param {i32} [frameSize=SAMPLES_PER_FRAME] - Samples per frame
   * @yields {Float32Array|Array<Float32Array>} Mono samples or stereo channels
   */
  async *[Symbol.asyncIterator](frameSize = SAMPLES_PER_FRAME) {
    const handle = await fs.promises.open(this.filePath, 'r')
    const frameBytes = (frameSize * this.channels * this.bitDepth) / 8
    const batchBytes = frameBytes * 32
    try {
      for (let offset = 0; offset < this.dataSize; offset += batchBytes) {
        const bytes = Buffer.alloc(batchBytes)
        const count = Math.min(batchBytes, this.dataSize - offset)
        let read = 0
        while (read < count) {
          const result = await handle.read(
            bytes,
            read,
            count - read,
            this.dataOffset + offset + read
          )
          if (result.bytesRead === 0) throw new Error('Truncated WAV input')
          read += result.bytesRead
        }
        for (
          let frameOffset = 0;
          frameOffset < count;
          frameOffset += frameBytes
        ) {
          yield this._processFrameBuffer(
            bytes.subarray(frameOffset, frameOffset + frameBytes),
            frameSize
          )
        }
      }
    } finally {
      await handle.close()
    }
  }

  /**
   * Process raw PCM buffer into float32 frame data
   *
   * @private
   * @param {Buffer} frameBuffer - Raw PCM data
   * @param {i32} frameSize - Number of samples per channel
   * @returns {Float32Array|Array<Float32Array>} Processed frame data
   */
  _processFrameBuffer(frameBuffer, frameSize) {
    const channels = this.channels | 0
    const bitDepth = this.bitDepth | 0
    const bytesPerSample = bitDepth / 8
    if (bitDepth === 16 && LITTLE_ENDIAN_PCM) {
      const samples = new Int16Array(
        frameBuffer.buffer,
        frameBuffer.byteOffset,
        frameBuffer.length / 2
      )
      const left = new Float32Array(frameSize)
      for (let i = 0; i < frameSize; i++) {
        left[i] = samples[i * channels] / 32768.0
      }
      if (channels === 1) return left

      const right = new Float32Array(frameSize)
      for (let i = 0; i < frameSize; i++) {
        right[i] = samples[i * 2 + 1] / 32768.0
      }
      return [left, right]
    }
    if (bitDepth === 32 && LITTLE_ENDIAN_PCM) {
      const samples = new Int32Array(
        frameBuffer.buffer,
        frameBuffer.byteOffset,
        frameBuffer.length / 4
      )
      const left = new Float32Array(frameSize)
      for (let i = 0; i < frameSize; i++) {
        left[i] = samples[i * channels] / 2147483648.0
      }
      if (channels === 1) return left

      const right = new Float32Array(frameSize)
      for (let i = 0; i < frameSize; i++) {
        right[i] = samples[i * 2 + 1] / 2147483648.0
      }
      return [left, right]
    }
    if (channels === 1) {
      const frame = new Float32Array(frameSize)
      for (let i = 0; i < frameSize; i++) {
        frame[i] = readPcmSample(frameBuffer, i * bytesPerSample, bitDepth)
      }
      return frame
    } else {
      const left = new Float32Array(frameSize)
      const right = new Float32Array(frameSize)
      for (let i = 0; i < frameSize; i++) {
        const offset = i * channels * bytesPerSample
        left[i] = readPcmSample(frameBuffer, offset, bitDepth)
        right[i] = readPcmSample(frameBuffer, offset + bytesPerSample, bitDepth)
      }
      return [left, right]
    }
  }
}

/**
 * Write a complete byte block, handling partial filesystem writes.
 *
 * @param {import('node:fs/promises').FileHandle} handle - Open output file
 * @param {Uint8Array} bytes - Bytes to write
 * @param {number|null} [position=null] - Absolute offset or the current position
 * @returns {Promise<void>}
 */
async function writeBytes(handle, bytes, position = null) {
  let offset = 0
  while (offset < bytes.length) {
    const result = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
      position === null ? null : position + offset
    )
    if (result.bytesWritten === 0) throw new Error('Could not write output')
    offset += result.bytesWritten
  }
}

/** Buffer frame writes without retaining the encoded or decoded stream. */
class BufferedWriter {
  /** @param {import('node:fs/promises').FileHandle} handle - Open output file */
  constructor(handle) {
    this.handle = handle
    this.buffer = Buffer.alloc(65536)
    this.used = 0
  }

  /**
   * @param {Uint8Array} bytes - Next frame's bytes
   * @returns {Promise<void>}
   */
  async write(bytes) {
    if (this.used + bytes.length > this.buffer.length) await this.flush()
    if (bytes.length >= this.buffer.length) {
      await writeBytes(this.handle, bytes)
      return
    }
    this.buffer.set(bytes, this.used)
    this.used += bytes.length
  }

  /** @returns {Promise<void>} Resolves when all pending bytes are written. */
  async flush() {
    if (this.used === 0) return
    await writeBytes(this.handle, this.buffer.subarray(0, this.used))
    this.used = 0
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
    const output = await fs.promises.open(
      outputFile,
      options.force ? 'w' : 'wx'
    )
    const writer = new BufferedWriter(output)
    /** @type {f64} Total sound units written to the stream. */
    let count = 0
    try {
      await writeBytes(
        output,
        AeaFile.createHeader(title, 0, reader.channels, reader.totalSamples)
      )
      for await (const frame of encodedFrames) {
        const bytes = serializeFrame(frame)
        await writer.write(bytes)
        count++
      }
      await writer.flush()
      const header = AeaFile.createHeader(
        title,
        count,
        reader.channels,
        reader.totalSamples
      )
      await writeBytes(output, header, 0)
    } finally {
      await output.close()
    }
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

    const output = await fs.promises.open(
      outputFile,
      options.force ? 'w' : 'wx'
    )
    const writer = new BufferedWriter(output)
    /** @type {f64} Total samples written to the stream. */
    let sampleCount = 0
    try {
      await writeBytes(
        output,
        createPcmWaveHeader({
          sampleCount: 0,
          sampleRate: SAMPLE_RATE,
          channels: metadata.channelCount,
        })
      )
      for await (const frame of decodedFrames) {
        const channels = metadata.channelCount === 1 ? [frame] : frame
        await writer.write(interleavePcm16(channels))
        sampleCount += channels[0].length
      }
      await writer.flush()
      const header = createPcmWaveHeader({
        sampleCount,
        sampleRate: SAMPLE_RATE,
        channels: metadata.channelCount,
      })
      await writeBytes(output, header, 0)
    } finally {
      await output.close()
    }
  } finally {
    progress.stop()
  }
}

/** Command-line options shared by parsing and help output. */
const CLI_OPTIONS = [
  { short: 'V', name: 'version', description: 'output the version number' },
  { short: 'e', name: 'encode', description: 'Encode WAV to AEA' },
  { short: 'd', name: 'decode', description: 'Decode AEA to WAV' },
  {
    short: 'q',
    name: 'quiet',
    description: 'Suppress all output except errors',
  },
  {
    short: 'f',
    name: 'force',
    description: 'Overwrite output file if it exists',
  },
  {
    short: 't',
    name: 'title',
    value: 'title',
    description: 'Custom UTF-8 title for AEA file metadata (encoding only)',
  },
  {
    short: 'b',
    name: 'bias',
    value: 'value',
    description: 'Bit allocation bias (default: 1.0)',
  },
  {
    short: 'm',
    name: 'modes',
    value: 'modes',
    description:
      'Fixed block modes [0/2],[0/2],[0/3] for low,mid,high bands (skips transient detection)',
  },
  { short: 'h', name: 'help', description: 'display help for command' },
]

/** Print usage and the supported options. */
function printHelp() {
  console.log(`Usage: carta1 [options] <input> <output>

ATRAC1 Audio Codec

Arguments:
  input                Input file path
  output               Output file path

Options:`)
  for (const option of CLI_OPTIONS) {
    const value = option.value ? ` <${option.value}>` : ''
    const flags = `-${option.short}, --${option.name}${value}`
    console.log(`  ${flags.padEnd(21)}${option.description}`)
  }
}

/**
 * Report invalid command-line syntax without an internal stack trace.
 *
 * @param {string} message - Argument error to display.
 * @returns {never}
 */
function argumentError(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}

/**
 * Parse long options, combined short flags, option values, and positional paths.
 * A double dash ends option parsing so paths may start with a dash.
 *
 * @param {string[]} args - Arguments after the executable and script names.
 * @param {string} version - Package version to display for --version.
 * @returns {{options: object, paths: string[]}} Parsed options and paths.
 */
function parseArguments(args, version) {
  const options = {}
  const paths = []
  let positional = false
  let unknownOption = null

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (positional || argument === '-' || !argument.startsWith('-')) {
      paths.push(argument)
      continue
    }
    if (argument === '--') {
      positional = true
      continue
    }

    const long = argument.startsWith('--')
    const equals = long ? argument.indexOf('=') : -1
    let offset = 1
    do {
      const name = long
        ? argument.slice(2, equals === -1 ? argument.length : equals)
        : argument[offset++]
      const option = CLI_OPTIONS.find((candidate) =>
        long ? candidate.name === name : candidate.short === name
      )
      const flag = long ? `--${name}` : `-${name}`
      if (
        !option ||
        (!option.value && equals !== -1) ||
        (option.name === 'help' && !long && offset < argument.length)
      ) {
        unknownOption ||= argument
        break
      }

      let value = true
      if (option.value) {
        if (equals !== -1) {
          value = argument.slice(equals + 1)
        } else if (!long && offset < argument.length) {
          value = argument.slice(offset)
        } else {
          value = args[++index]
          if (value === undefined) {
            argumentError(`option '${flag}' argument missing`)
          }
        }
        offset = argument.length
      }

      if (option.name === 'help') {
        printHelp()
        process.exit(0)
      }
      if (option.name === 'version') {
        console.log(version)
        process.exit(0)
      }
      options[option.name] = option.name === 'bias' ? parseFloat(value) : value
    } while (!long && offset < argument.length)
  }

  if (unknownOption) argumentError(`unknown option '${unknownOption}'`)
  if (paths.length < 2) {
    argumentError(
      `missing required argument '${paths.length ? 'output' : 'input'}'`
    )
  }
  return { options, paths }
}

/**
 * Main CLI entry point
 *
 * Parses command line arguments and executes encoding or decoding
 * with error handling and validation.
 *
 * @returns {Promise<void>} Resolves when operation is complete
 */
async function main() {
  const { version } = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  )
  const { options, paths } = parseArguments(process.argv.slice(2), version)
  const [inputFile, outputFile] = paths

  // Validate operation mode
  const modes = [options.encode, options.decode].filter(Boolean)
  if (modes.length === 0) {
    console.error('Error: Must specify --encode or --decode')
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

try {
  await main()
} catch (error) {
  console.error(`An unhandled error occurred: ${error.message}`)
  console.error(error.stack)
  process.exit(1)
}
