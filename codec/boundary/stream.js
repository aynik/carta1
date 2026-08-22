/**
 * Carta1 chronological stream adapters.
 */

import { AEA_HEADER_SIZE, SOUND_UNIT_SIZE } from '../core/constants.js'
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
 * @param {Float32Array|[Float32Array, Float32Array]} frame
 * @param {number} channelCount
 * @throws {TypeError} If the frame does not match the selected mode
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
}

/**
 * Create an empty structured frame for an unmatched stereo channel.
 *
 * @returns {Object}
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
   * @param {Object} [options]
   * @param {number} [options.channelCount=1]
   * @param {Function} [options.onProgress]
   * @param {EncoderOptions} [options.encoderOptions]
   */
  constructor(options = {}) {
    const { channelCount = 1, onProgress, encoderOptions } = options
    validateChannels(channelCount)

    const codecOptions = encoderOptions || new EncoderOptions()
    this.channelCount = channelCount
    this.onProgress = onProgress
    this.frameIndex = 0
    this.leftEncoder = encode(codecOptions)
    this.rightEncoder = channelCount === 2 ? encode(codecOptions) : null
  }

  /**
   * @param {AsyncIterable<Float32Array>|AsyncIterable<[Float32Array, Float32Array]>} frames
   * @returns {AsyncGenerator<Object>}
   */
  async *frames(frames) {
    for await (const frame of frames) {
      validateChunk(frame, this.channelCount)
      if (this.channelCount === 1) {
        yield this.leftEncoder(frame)
      } else {
        const [left, right] = frame
        yield this.leftEncoder(left)
        yield this.rightEncoder(right)
      }

      if (this.onProgress) {
        this.onProgress(this.frameIndex++)
      }
    }
  }
}

/**
 * Decode chronological structured frames.
 */
export class AeaStreamingDecoder {
  /**
   * @param {Object} [options]
   * @param {number} [options.channelCount=1]
   * @param {Function} [options.onProgress]
   */
  constructor(options = {}) {
    const { channelCount = 1, onProgress } = options
    validateChannels(channelCount)

    this.channelCount = channelCount
    this.onProgress = onProgress
    this.frameIndex = 0
    this.leftFrame = null
    this.leftDecoder = decode()
    this.rightDecoder = channelCount === 2 ? decode() : null
  }

  /**
   * @param {AsyncIterable<Object>} frames
   * @returns {AsyncGenerator<Float32Array|[Float32Array, Float32Array]>}
   */
  async *frames(frames) {
    for await (const frame of frames) {
      if (this.channelCount === 1) {
        yield this.leftDecoder(frame)
        this.reportProgress()
      } else if (this.leftFrame === null) {
        this.leftFrame = frame
      } else {
        yield [this.leftDecoder(this.leftFrame), this.rightDecoder(frame)]
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
      yield [
        this.leftDecoder(this.leftFrame),
        this.rightDecoder(createDummyFrame()),
      ]
      this.leftFrame = null
      this.reportProgress()
    }
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
 * @param {Object} [options]
 * @returns {AeaStreamingEncoder}
 */
export function createAeaStreamingEncoder(options) {
  return new AeaStreamingEncoder(options)
}

/**
 * Create a chronological decoder.
 *
 * @param {Object} [options]
 * @returns {AeaStreamingDecoder}
 */
export function createAeaStreamingDecoder(options) {
  return new AeaStreamingDecoder(options)
}

/**
 * Encode complete planar PCM buffers into an AEA byte image.
 *
 * @param {Float32Array[]} channels
 * @param {Object} [options]
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

  const header = AeaFile.createHeader(title, encoded.length, channels.length)
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
