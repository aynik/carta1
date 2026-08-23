/**
 * Carta1 chronological stream adapters.
 */

import {
  AEA_HEADER_SIZE,
  SAMPLES_PER_FRAME,
  SOUND_UNIT_SIZE,
  STREAM_FLUSH_TAIL_FRAMES,
  STREAM_PRIMING_SAMPLES,
} from '../core/constants.js'
import { EncoderOptions } from '../core/options.js'
import { decode } from '../pipeline/decoder.js'
import { encode } from '../pipeline/encoder.js'
import { deserializeFrame, serializeFrame } from '../syntax/frame.js'
import { AeaFile } from './container.js'
import { frameBufferToFrames, joinChannelFrames } from './pcm.js'

/**
 * Validate a supported channel mode.
 *
 * @param {number} channelCount
 * @throws {Error} If the channel count is unsupported
 */
function validateChannels(channelCount) {
  if (channelCount !== 1 && channelCount !== 2) {
    throw new Error(`Unsupported channel count: ${channelCount}`)
  }
}

/**
 * Validate one PCM frame in the selected channel mode.
 *
 * @param {object} frame
 * @param {number} channelCount
 * @throws {TypeError} If the frame does not match the selected mode
 * @throws {RangeError} If a selected channel is not one complete frame
 */
function validateChunk(frame, channelCount) {
  const channels = channelCount === 1 ? [frame] : frame
  if (
    !Array.isArray(channels) ||
    channels.length !== channelCount ||
    channels.some((channel) => !(channel instanceof Float32Array))
  ) {
    throw new TypeError(
      `ATRAC1 streaming requires ${channelCount} Float32 channel${
        channelCount === 1 ? '' : 's'
      } per frame`
    )
  }

  if (channels.some((channel) => channel.length !== SAMPLES_PER_FRAME)) {
    throw new RangeError(
      `ATRAC1 streaming requires exactly ${SAMPLES_PER_FRAME} samples per channel`
    )
  }
}

/**
 * Create an empty structured frame for an unmatched stereo channel.
 *
 * @returns {object}
 */
function createDummyFrame() {
  return {
    nBfu: 0,
    blockModes: [0, 0, 0],
    scaleFactorIndices: new Int32Array(0),
    wordLengthIndices: new Int32Array(0),
    quantizedCoefficients: [],
  }
}

/**
 * Collect an async iterable.
 *
 * @param {AsyncIterable} frames
 * @returns {Promise<Array>}
 */
async function collect(frames) {
  const output = []
  for await (const frame of frames) {
    output.push(frame)
  }
  return output
}

/**
 * Encode chronological PCM frames.
 */
export class AeaStreamingEncoder {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    const { channelCount = 1, onProgress, encoderOptions } = options
    validateChannels(channelCount)

    const codecOptions = encoderOptions || new EncoderOptions()
    this.channelCount = channelCount
    this.onProgress = onProgress
    this.frameIndex = 0
    this.sampleCount = 0
    this.finalized = false
    this.leftEncoder = encode(codecOptions)
    this.rightEncoder = channelCount === 2 ? encode(codecOptions) : null
  }

  /**
   * @param {AsyncIterable<object>} frames
   * @returns {AsyncGenerator<object>}
   */
  async *frames(frames) {
    if (this.finalized) {
      throw new Error('ATRAC1 encoder has already been finalized')
    }
    for await (const frame of frames) {
      validateChunk(frame, this.channelCount)
      if (this.channelCount === 1) {
        yield this.leftEncoder(frame)
      } else {
        const [left, right] = frame
        yield this.leftEncoder(left)
        yield this.rightEncoder(right)
      }

      this.sampleCount += SAMPLES_PER_FRAME

      if (this.onProgress) {
        this.onProgress(this.frameIndex++)
      }
    }
  }

  /**
   * Flush the synthesis tail after a nonempty stream.
   *
   * @returns {Generator<object>}
   */
  *finish() {
    if (this.finalized) return
    this.finalized = true
    if (this.sampleCount === 0) return
    const silence = new Float32Array(SAMPLES_PER_FRAME)
    for (let frame = 0; frame < STREAM_FLUSH_TAIL_FRAMES; frame++) {
      yield this.leftEncoder(silence)
      if (this.channelCount === 2) yield this.rightEncoder(silence)
    }
  }
}

/**
 * Decode chronological structured frames.
 */
export class AeaStreamingDecoder {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    const {
      channelCount = 1,
      onProgress,
      primingSampleCount = 0,
      sampleCount = Number.POSITIVE_INFINITY,
    } = options
    validateChannels(channelCount)

    this.channelCount = channelCount
    this.onProgress = onProgress
    this.frameIndex = 0
    this.primingSampleCount = primingSampleCount
    this.sampleCount = sampleCount
    this.timelinePosition = 0
    this.emittedSamples = 0
    this.leftFrame = null
    this.leftDecoder = decode()
    this.rightDecoder = channelCount === 2 ? decode() : null
  }

  /**
   * @param {AsyncIterable<object>} frames
   * @returns {AsyncGenerator<object>}
   */
  async *frames(frames) {
    for await (const frame of frames) {
      if (this.channelCount === 1) {
        yield this.trim(this.leftDecoder(frame))
        this.reportProgress()
      } else if (this.leftFrame === null) {
        this.leftFrame = frame
      } else {
        yield this.trim([
          this.leftDecoder(this.leftFrame),
          this.rightDecoder(frame),
        ])
        this.leftFrame = null
        this.reportProgress()
      }
    }
  }

  /**
   * Complete an unmatched stereo pair.
   *
   * @returns {Generator<[Float32Array, Float32Array]>}
   */
  *finish() {
    if (this.channelCount === 2 && this.leftFrame !== null) {
      yield this.trim([
        this.leftDecoder(this.leftFrame),
        this.rightDecoder(createDummyFrame()),
      ])
      this.leftFrame = null
      this.reportProgress()
    }
    if (
      Number.isFinite(this.sampleCount) &&
      this.emittedSamples !== this.sampleCount
    ) {
      throw new RangeError(
        `Truncated ATRAC1 timeline: decoded ${this.emittedSamples} of ${this.sampleCount} samples`
      )
    }
  }

  /**
   * Apply stream priming and visible-length trimming once per PCM frame.
   *
   * @param {object} frame
   * @returns {object}
   * @private
   */
  trim(frame) {
    const start = Math.max(0, this.primingSampleCount - this.timelinePosition)
    const remaining = this.sampleCount - this.emittedSamples
    const count = Math.max(0, Math.min(SAMPLES_PER_FRAME - start, remaining))
    this.timelinePosition += SAMPLES_PER_FRAME
    this.emittedSamples += count
    if (this.channelCount === 1) return frame.slice(start, start + count)
    return frame.map((channel) => channel.slice(start, start + count))
  }

  /**
   * Publish one frame's progress.
   *
   * @private
   */
  reportProgress() {
    if (this.onProgress) {
      this.onProgress(this.frameIndex++)
    }
  }
}

/**
 * Create a chronological encoder.
 *
 * @param {object} [options]
 * @returns {AeaStreamingEncoder}
 */
export function createAeaStreamingEncoder(options) {
  return new AeaStreamingEncoder(options)
}

/**
 * Create a chronological decoder.
 *
 * @param {object} [options]
 * @returns {AeaStreamingDecoder}
 */
export function createAeaStreamingDecoder(options) {
  return new AeaStreamingDecoder(options)
}

/**
 * Encode complete planar PCM buffers into an AEA byte image.
 *
 * @param {Float32Array[]} channels
 * @param {object} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function encodeAeaPcm(channels, options = {}) {
  if (
    !Array.isArray(channels) ||
    (channels.length !== 1 && channels.length !== 2) ||
    channels.some((channel) => !(channel instanceof Float32Array))
  ) {
    throw new TypeError('ATRAC1 encoding requires one or two Float32 channels')
  }

  const { title = 'encoded by carta1', ...encoderValues } = options
  const encoder = createAeaStreamingEncoder({
    channelCount: channels.length,
    encoderOptions: new EncoderOptions(encoderValues),
  })
  const frames = encoder.frames(frameBufferToFrames(channels))
  const encoded = await collect(frames)
  encoded.push(...encoder.finish())

  const header = AeaFile.createHeader(
    title,
    encoded.length,
    channels.length,
    channels[0].length,
    STREAM_PRIMING_SAMPLES
  )
  const output = new Uint8Array(
    header.length + encoded.length * SOUND_UNIT_SIZE
  )
  output.set(header)
  encoded.forEach((frame, index) => {
    output.set(serializeFrame(frame), header.length + index * SOUND_UNIT_SIZE)
  })
  return output
}

/**
 * Decode a complete AEA byte image into planar normalized PCM buffers.
 *
 * @param {Uint8Array|ArrayBuffer|Blob} input
 * @returns {Promise<Float32Array[]>}
 */
export async function decodeAeaPcm(input) {
  let bytes
  if (input instanceof Blob) {
    bytes = new Uint8Array(await input.arrayBuffer())
  } else if (input instanceof Uint8Array) {
    bytes = input
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input)
  } else {
    throw new TypeError('ATRAC1 decoding requires AEA bytes or a Blob')
  }

  const info = AeaFile.parseHeader(bytes.subarray(0, AEA_HEADER_SIZE))
  const decoder = createAeaStreamingDecoder({
    channelCount: info.channelCount,
    primingSampleCount: info.primingSampleCount,
    sampleCount: info.sampleCount,
  })
  const frames = (async function* () {
    for (
      let offset = AEA_HEADER_SIZE;
      offset + SOUND_UNIT_SIZE <= bytes.length;
      offset += SOUND_UNIT_SIZE
    ) {
      yield deserializeFrame(bytes.subarray(offset, offset + SOUND_UNIT_SIZE))
    }
  })()
  const decoded = await collect(decoder.frames(frames))
  decoded.push(...decoder.finish())

  if (info.channelCount === 1) {
    return [joinChannelFrames(decoded)]
  }
  return [
    joinChannelFrames(decoded.map(([left]) => left)),
    joinChannelFrames(decoded.map(([, right]) => right)),
  ]
}
