/**
 * Carta1 public processing facade.
 */

import {
  AEA_HEADER_SIZE,
  SAMPLE_RATE,
  SAMPLES_PER_FRAME,
  SOUND_UNIT_SIZE,
  STREAM_FLUSH_TAIL_FRAMES,
  STREAM_PRIMING_SAMPLES,
} from '../core/constants.js'
import { deserializeFrame, serializeFrame } from '../syntax/frame.js'
import { AeaFile } from './container.js'
import { createPcmWave, frameBufferToFrames, joinChannelFrames } from './pcm.js'
import {
  createAeaStreamingDecoder,
  createAeaStreamingEncoder,
  decodeAeaPcm,
  encodeAeaPcm,
} from './stream.js'

/** @typedef {import('../quantization/stage.js').StructuredFrame} StructuredFrame */
/** @typedef {import('./stream.js').PcmFrame} PcmFrame */

/**
 * @typedef {Object} AeaBlobOptions
 * @property {string} [title]
 * @property {number} [channelCount=1]
 * @property {number} [sampleCount]
 */

/**
 * High-level audio processing facade.
 */
export class AudioProcessor {
  /**
   * @param {Float32Array[]} channels
   * @param {import('./stream.js').AeaEncodeOptions} [options]
   * @returns {Promise<Uint8Array>}
   */
  static encodeAeaPcm(channels, options = {}) {
    return encodeAeaPcm(channels, options)
  }

  /**
   * @param {Uint8Array|ArrayBuffer|Blob} input
   * @returns {Promise<Float32Array[]>}
   */
  static decodeAeaPcm(input) {
    return decodeAeaPcm(input)
  }

  /**
   * @param {AsyncIterable<PcmFrame>} audioFrames
   * @param {import('./stream.js').StreamingEncoderOptions} [options]
   * @returns {AsyncGenerator<StructuredFrame>}
   */
  static async *encodeStream(audioFrames, options = {}) {
    const encoder = createAeaStreamingEncoder(options)
    yield* encoder.frames(audioFrames)
    yield* encoder.finish()
  }

  /**
   * @param {AsyncIterable<StructuredFrame>} encodedFrames
   * @param {import('./stream.js').StreamingDecoderOptions} [options]
   * @returns {AsyncGenerator<PcmFrame>}
   */
  static async *decodeStream(encodedFrames, options = {}) {
    const decoder = createAeaStreamingDecoder(options)
    yield* decoder.frames(encodedFrames)
    yield* decoder.finish()
  }

  /**
   * @param {Float32Array[]} buffers
   * @param {number} [frameSize]
   * @returns {Generator<Float32Array>|Generator<[Float32Array, Float32Array]>}
   */
  static *frameBufferToFrames(buffers, frameSize) {
    yield* frameBufferToFrames(buffers, frameSize)
  }

  /**
   * @template T
   * @param {AsyncIterable<T>|Iterable<T>} frameStream
   * @returns {Promise<Array<T>>}
   */
  static async collectFrames(frameStream) {
    const frames = []
    for await (const frame of frameStream) {
      frames.push(frame)
    }
    return frames
  }

  /**
   * @param {AsyncIterable<StructuredFrame>} encodedFrames
   * @param {AeaBlobOptions} [options]
   * @returns {Promise<Blob>}
   */
  static async createAeaBlob(encodedFrames, options = {}) {
    const { title = 'encoded by atrac1.js', channelCount = 1 } = options
    const frames = []
    for await (const frame of encodedFrames) {
      frames.push(serializeFrame(frame))
    }

    const timelineFrames = frames.length / channelCount
    const sampleCount =
      options.sampleCount ??
      Math.max(0, timelineFrames - STREAM_FLUSH_TAIL_FRAMES) * SAMPLES_PER_FRAME
    const header = AeaFile.createHeader(
      title,
      frames.length,
      channelCount,
      sampleCount,
      STREAM_PRIMING_SAMPLES
    )
    return new Blob([header, ...frames], { type: 'application/octet-stream' })
  }

  /**
   * @param {Blob} blob
   * @returns {Promise<{info: {title: string, frameCount: number, channelCount: number}, frameData: Uint8Array[]}>}
   */
  static async parseAeaBlob(blob) {
    const buffer = await blob.arrayBuffer()
    const header = new Uint8Array(buffer.slice(0, AEA_HEADER_SIZE))
    const info = AeaFile.parseHeader(header)
    const frameData = []

    for (let offset = AEA_HEADER_SIZE; offset < buffer.byteLength;) {
      const frame = new Uint8Array(
        buffer.slice(offset, offset + SOUND_UNIT_SIZE)
      )
      if (frame.length === SOUND_UNIT_SIZE) {
        frameData.push(frame)
      }
      offset += SOUND_UNIT_SIZE
    }
    return { info, frameData }
  }

  /**
   * @param {Uint8Array[]} frameData
   * @returns {Generator<StructuredFrame>}
   */
  static *deserializedFrameStream(frameData) {
    for (const frame of frameData) {
      yield deserializeFrame(frame)
    }
  }

  /**
   * @param {Float32Array[]|[Float32Array, Float32Array][]} pcmFrames
   * @param {number} [channelCount=1]
   * @param {number} [sampleRate=SAMPLE_RATE]
   * @returns {Blob}
   */
  static createPcmWaveBlob(
    pcmFrames,
    channelCount = 1,
    sampleRate = SAMPLE_RATE
  ) {
    let channels
    if (channelCount === 1) {
      channels = [joinChannelFrames(pcmFrames)]
    } else if (channelCount === 2) {
      channels = [
        joinChannelFrames(pcmFrames.map(([left]) => left)),
        joinChannelFrames(pcmFrames.map(([, right]) => right)),
      ]
    } else {
      throw new Error(`Unsupported channel count: ${channelCount}`)
    }
    return new Blob([createPcmWave(channels, { sampleRate })], {
      type: 'audio/wav',
    })
  }

  /**
   * Preserve the supported WAVE facade name.
   *
   * @param {Float32Array[]|[Float32Array, Float32Array][]} pcmFrames
   * @param {number} [channelCount=1]
   * @param {number} [sampleRate=SAMPLE_RATE]
   * @returns {Blob}
   */
  static createWavBlob(pcmFrames, channelCount = 1, sampleRate = SAMPLE_RATE) {
    return AudioProcessor.createPcmWaveBlob(pcmFrames, channelCount, sampleRate)
  }

  /**
   * Assemble PCM frames using the supported interleaved result shape.
   *
   * @param {Float32Array[]|[Float32Array, Float32Array][]} pcmFrames
   * @param {number} channelCount
   * @returns {Float32Array}
   */
  static assemblePcmFrames(pcmFrames, channelCount) {
    if (channelCount === 1) {
      return joinChannelFrames(pcmFrames)
    }
    if (channelCount !== 2) {
      throw new Error(`Unsupported channel count: ${channelCount}`)
    }

    const left = joinChannelFrames(pcmFrames.map(([channel]) => channel))
    const right = joinChannelFrames(pcmFrames.map(([, channel]) => channel))
    const pcm = new Float32Array(Math.max(left.length, right.length) * 2)
    for (let i = 0; i < pcm.length / 2; i++) {
      pcm[i * 2] = left[i] ?? 0
      pcm[i * 2 + 1] = right[i] ?? 0
    }
    return pcm
  }
}
