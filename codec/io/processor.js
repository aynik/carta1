/**
 * Carta1 Audio Codec - Audio Processing Module
 *
 * High-level audio processing interface that provides stream-based encoding and decoding
 * for ATRAC1 audio format. Handles both mono and stereo audio processing with proper
 * delay compensation and frame management.
 *
 * Key features:
 * - Stream-based processing for large audio files
 * - Automatic delay compensation for codec processing
 * - Support for mono and stereo audio
 * - Progress tracking callbacks
 * - AEA file format creation and parsing
 * - WAV file generation from decoded audio
 */

import { encode } from '../pipeline/encoder.js'
import { decode } from '../pipeline/decoder.js'
import { EncoderOptions } from '../core/options.js'
import {
  SAMPLES_PER_FRAME,
  SAMPLE_RATE,
  AEA_HEADER_SIZE,
  SOUND_UNIT_SIZE,
  WAV_HEADER_SIZE,
  WAV_BYTES_PER_SAMPLE,
  WAV_BITS_PER_SAMPLE,
  WAV_PCM_MAX_POSITIVE,
  WAV_PCM_MAX_NEGATIVE,
  WAV_DATA_OFFSET,
} from '../core/constants.js'
import { serializeFrame, deserializeFrame, AeaFile } from './serialization.js'
import {
  withFlushSamples,
  withDelayCompensation,
  withStereoFlushSamples,
  withStereoDelayCompensation,
} from '../utils.js'

/**
 * Audio processing utility class providing high-level encoding and decoding operations
 */
export class AudioProcessor {
  /**
   * Encodes a stream of audio frames to ATRAC1 format
   * @param {AsyncIterable<Float64Array>|AsyncIterable<[Float64Array, Float64Array]>} audioFrames - Audio frame stream
   * @param {Object} [options={}] - Encoding options
   * @param {number} [options.channelCount=1] - Number of audio channels (1 or 2)
   * @param {Function} [options.onProgress] - Progress callback function
   * @param {EncoderOptions} [options.encoderOptions] - Encoder configuration options
   * @returns {AsyncGenerator<Object>} Stream of encoded frame data
   * @throws {Error} If unsupported channel count is provided
   */
  static async *encodeStream(audioFrames, options = {}) {
    const { channelCount = 1, onProgress, encoderOptions } = options

    if (channelCount === 1) {
      yield* AudioProcessor._encodeMonoStream(
        audioFrames,
        onProgress,
        encoderOptions
      )
    } else if (channelCount === 2) {
      yield* AudioProcessor._encodeStereoStream(
        audioFrames,
        onProgress,
        encoderOptions
      )
    } else {
      throw new Error(`Unsupported channel count: ${channelCount}`)
    }
  }

  /**
   * Internal method for encoding mono audio streams
   * @param {AsyncIterable<Float64Array>} audioFrames - Mono audio frame stream
   * @param {Function} onProgress - Progress callback function
   * @param {EncoderOptions} encoderOptions - Encoder configuration
   * @returns {AsyncGenerator<Object>} Stream of encoded frame data
   * @private
   */
  static async *_encodeMonoStream(audioFrames, onProgress, encoderOptions) {
    const options = encoderOptions || new EncoderOptions()
    const encoder = encode(options)
    let frameIndex = 0
    for await (const frame of withFlushSamples(audioFrames)) {
      const result = encoder(frame)
      yield result

      if (onProgress) {
        onProgress(frameIndex++)
      }
    }
  }

  /**
   * Internal method for encoding stereo audio streams
   * @param {AsyncIterable<[Float64Array, Float64Array]>} audioFrames - Stereo audio frame stream
   * @param {Function} onProgress - Progress callback function
   * @param {EncoderOptions} encoderOptions - Encoder configuration
   * @returns {AsyncGenerator<Object>} Stream of encoded frame data (left then right)
   * @private
   */
  static async *_encodeStereoStream(audioFrames, onProgress, encoderOptions) {
    const options = encoderOptions || new EncoderOptions()
    const leftEncoder = encode(options)
    const rightEncoder = encode(options)
    let frameIndex = 0

    for await (const [leftFrame, rightFrame] of withStereoFlushSamples(
      audioFrames
    )) {
      const leftResult = leftEncoder(leftFrame)
      const rightResult = rightEncoder(rightFrame)

      yield leftResult
      yield rightResult

      if (onProgress) {
        onProgress(frameIndex++)
      }
    }
  }

  /**
   * Decodes a stream of ATRAC1 encoded frames back to PCM audio
   * @param {AsyncIterable<Object>} encodedFrames - Stream of encoded frame data
   * @param {Object} [options={}] - Decoding options
   * @param {number} [options.channelCount=1] - Number of audio channels (1 or 2)
   * @param {Function} [options.onProgress] - Progress callback function
   * @returns {AsyncGenerator<Float64Array>|AsyncGenerator<[Float64Array, Float64Array]>} Stream of decoded PCM frames
   * @throws {Error} If unsupported channel count is provided
   */
  static async *decodeStream(encodedFrames, options = {}) {
    const { channelCount = 1, onProgress } = options

    if (channelCount === 1) {
      yield* AudioProcessor._decodeMonoStream(encodedFrames, onProgress)
    } else if (channelCount === 2) {
      yield* AudioProcessor._decodeStereoStream(encodedFrames, onProgress)
    } else {
      throw new Error(`Unsupported channel count: ${channelCount}`)
    }
  }

  /**
   * Internal method for decoding mono audio streams
   * @param {AsyncIterable<Object>} encodedFrames - Mono encoded frame stream
   * @param {Function} onProgress - Progress callback function
   * @returns {AsyncGenerator<Float64Array>} Stream of decoded mono PCM frames
   * @private
   */
  static async *_decodeMonoStream(encodedFrames, onProgress) {
    const decoder = decode()
    let frameIndex = 0

    // Create raw PCM frame stream
    const rawPcmFrames = async function* () {
      for await (const frame of encodedFrames) {
        const result = decoder(frame)
        yield result

        if (onProgress) {
          onProgress(frameIndex++)
        }
      }
    }

    // Always apply delay compensation
    yield* withDelayCompensation(rawPcmFrames())
  }

  /**
   * Internal method for decoding stereo audio streams
   * @param {AsyncIterable<Object>} encodedFrames - Stereo encoded frame stream (interleaved left/right)
   * @param {Function} onProgress - Progress callback function
   * @returns {AsyncGenerator<[Float64Array, Float64Array]>} Stream of decoded stereo PCM frame pairs
   * @private
   */
  static async *_decodeStereoStream(encodedFrames, onProgress) {
    const leftDecoder = decode()
    const rightDecoder = decode()
    let frameIndex = 0

    const rawPcmFrames = async function* () {
      let leftFrame = null
      let isLeftChannel = true

      for await (const frame of encodedFrames) {
        if (isLeftChannel) {
          leftFrame = frame
        } else {
          const rightFrame = frame

          // Decode and yield the pair
          const leftResult = leftDecoder(leftFrame)
          const rightResult = rightDecoder(rightFrame)

          yield [leftResult, rightResult]

          if (onProgress) {
            onProgress(frameIndex++)
          }
        }

        isLeftChannel = !isLeftChannel
      }

      if (!isLeftChannel && leftFrame) {
        const rightFrame = AudioProcessor._createDummyFrame()
        const leftResult = leftDecoder(leftFrame)
        const rightResult = rightDecoder(rightFrame)

        yield [leftResult, rightResult]

        if (onProgress) {
          onProgress(frameIndex++)
        }
      }
    }

    // Always apply stereo delay compensation
    yield* withStereoDelayCompensation(rawPcmFrames())
  }

  /**
   * Converts channel buffer arrays to frame-based stream format
   * @param {Float64Array[]} buffers - Array of channel buffers (1 for mono, 2 for stereo)
   * @param {number} [frameSize=SAMPLES_PER_FRAME] - Frame size in samples
   * @returns {Generator<Float64Array>|Generator<[Float64Array, Float64Array]>} Stream of audio frames
   * @throws {Error} If unsupported channel count is provided
   */
  static *frameBufferToFrames(buffers, frameSize = SAMPLES_PER_FRAME) {
    const channelCount = buffers.length

    if (channelCount === 1) {
      const [left] = buffers
      for (let i = 0; i < left.length; i += frameSize) {
        const frame = new Float64Array(frameSize)
        const end = Math.min(i + frameSize, left.length)
        for (let j = 0; j < end - i; j++) {
          frame[j] = left[i + j]
        }
        yield frame
      }
    } else if (channelCount === 2) {
      const [left, right] = buffers
      const maxLength = Math.max(left.length, right.length)

      for (let i = 0; i < maxLength; i += frameSize) {
        const leftFrame = new Float64Array(frameSize)
        const rightFrame = new Float64Array(frameSize)

        const end = Math.min(i + frameSize, maxLength)

        for (let j = 0; j < end - i; j++) {
          leftFrame[j] = i + j < left.length ? left[i + j] : 0
          rightFrame[j] = i + j < right.length ? right[i + j] : 0
        }

        yield [leftFrame, rightFrame]
      }
    } else {
      throw new Error(`Unsupported channel count: ${channelCount}`)
    }
  }

  /**
   * Collects all frames from a stream into an array
   * @param {AsyncIterable} frameStream - Stream of frames to collect
   * @returns {Promise<Array>} Array of all frames from the stream
   */
  static async collectFrames(frameStream) {
    const frames = []
    for await (const frame of frameStream) {
      frames.push(frame)
    }
    return frames
  }

  /**
   * Creates a dummy frame for padding purposes
   * @returns {Object} Empty frame structure
   * @private
   */
  static _createDummyFrame() {
    return {
      nBfu: 0,
      blockModes: [0, 0, 0],
      scaleFactorIndices: new Int32Array(0),
      wordLengthIndices: new Int32Array(0),
      quantizedCoefficients: [],
    }
  }

  /**
   * Creates an AEA file blob from encoded frames
   * @param {AsyncIterable<Object>} encodedFrames - Stream of encoded frame data
   * @param {Object} [options={}] - AEA file options
   * @param {string} [options.title='encoded by atrac1.js'] - File title
   * @param {number} [options.channelCount=1] - Number of audio channels
   * @returns {Promise<Blob>} AEA file blob
   */
  static async createAeaBlob(encodedFrames, options = {}) {
    const { title = 'encoded by atrac1.js', channelCount = 1 } = options

    const frames = []
    for await (const frame of encodedFrames) {
      frames.push(serializeFrame(frame))
    }

    const header = AeaFile.createHeader(title, frames.length, channelCount)
    const totalSize =
      header.length + frames.reduce((sum, frame) => sum + frame.length, 0)

    const buffer = new Uint8Array(totalSize)
    buffer.set(header, 0)

    let offset = header.length
    for (const frame of frames) {
      buffer.set(frame, offset)
      offset += frame.length
    }

    return new Blob([buffer], { type: 'application/octet-stream' })
  }

  /**
   * Creates a WAV file blob from PCM audio frames
   * @param {Float64Array[]|Float64Array|[Float64Array, Float64Array][]} pcmFrames - PCM audio frames
   * @param {number} [channelCount=1] - Number of audio channels
   * @param {number} [sampleRate=SAMPLE_RATE] - Audio sample rate
   * @returns {Blob} WAV file blob
   * @throws {Error} If unsupported channel count is provided
   */
  static createWavBlob(pcmFrames, channelCount = 1, sampleRate = SAMPLE_RATE) {
    const frames = Array.isArray(pcmFrames) ? pcmFrames : [pcmFrames]

    if (channelCount === 1) {
      return AudioProcessor._createMonoWavBlob(frames, sampleRate)
    } else if (channelCount === 2) {
      return AudioProcessor._createStereoWavBlob(frames, sampleRate)
    } else {
      throw new Error(`Unsupported channel count: ${channelCount}`)
    }
  }

  /**
   * Creates a mono WAV file blob from PCM frames
   * @param {Float64Array[]} frames - Array of mono PCM frames
   * @param {number} sampleRate - Audio sample rate
   * @returns {Blob} Mono WAV file blob
   * @private
   */
  static _createMonoWavBlob(frames, sampleRate) {
    const totalSamples = frames.reduce((sum, frame) => sum + frame.length, 0)
    const buffer = new ArrayBuffer(
      WAV_HEADER_SIZE + totalSamples * WAV_BYTES_PER_SAMPLE
    )
    const view = new DataView(buffer)

    // WAV header
    AudioProcessor._writeWavHeader(view, totalSamples, 1, sampleRate)

    // PCM data using DataView for consistency
    let offset = WAV_HEADER_SIZE
    for (const frame of frames) {
      for (let i = 0; i < frame.length; i++) {
        const sample = Math.max(-1, Math.min(1, frame[i]))
        view.setInt16(
          offset,
          sample < 0
            ? sample * WAV_PCM_MAX_NEGATIVE
            : sample * WAV_PCM_MAX_POSITIVE,
          true
        )
        offset += WAV_BYTES_PER_SAMPLE
      }
    }

    return new Blob([buffer], { type: 'audio/wav' })
  }

  /**
   * Creates a stereo WAV file blob from PCM frame pairs
   * @param {[Float64Array, Float64Array][]} framePairs - Array of stereo PCM frame pairs
   * @param {number} sampleRate - Audio sample rate
   * @returns {Blob} Stereo WAV file blob
   * @private
   */
  static _createStereoWavBlob(framePairs, sampleRate) {
    const totalSamples = framePairs.reduce(
      (sum, [left, right]) => sum + Math.max(left.length, right.length),
      0
    )

    const buffer = new ArrayBuffer(
      WAV_HEADER_SIZE + totalSamples * WAV_BYTES_PER_SAMPLE * 2
    )
    const view = new DataView(buffer)

    // WAV header
    AudioProcessor._writeWavHeader(view, totalSamples, 2, sampleRate)

    // Interleaved PCM data using DataView for consistency
    let offset = WAV_HEADER_SIZE
    for (const [leftFrame, rightFrame] of framePairs) {
      const frameLength = Math.max(leftFrame.length, rightFrame.length)
      for (let i = 0; i < frameLength; i++) {
        const leftSample = i < leftFrame.length ? leftFrame[i] : 0
        const rightSample = i < rightFrame.length ? rightFrame[i] : 0
        const leftClipped = Math.max(-1, Math.min(1, leftSample))
        const rightClipped = Math.max(-1, Math.min(1, rightSample))
        view.setInt16(
          offset,
          leftClipped < 0
            ? leftClipped * WAV_PCM_MAX_NEGATIVE
            : leftClipped * WAV_PCM_MAX_POSITIVE,
          true
        )
        offset += WAV_BYTES_PER_SAMPLE
        view.setInt16(
          offset,
          rightClipped < 0
            ? rightClipped * WAV_PCM_MAX_NEGATIVE
            : rightClipped * WAV_PCM_MAX_POSITIVE,
          true
        )
        offset += WAV_BYTES_PER_SAMPLE
      }
    }

    return new Blob([buffer], { type: 'audio/wav' })
  }

  /**
   * Writes WAV file header to DataView
   * @param {DataView} view - DataView to write to
   * @param {number} totalSamples - Total number of samples
   * @param {number} channelCount - Number of audio channels
   * @param {number} sampleRate - Audio sample rate
   * @private
   */
  static _writeWavHeader(view, totalSamples, channelCount, sampleRate) {
    const byteRate = sampleRate * channelCount * WAV_BYTES_PER_SAMPLE
    const blockAlign = channelCount * WAV_BYTES_PER_SAMPLE
    const dataSize = totalSamples * blockAlign
    const fileSize = WAV_DATA_OFFSET + dataSize

    let pos = 0

    // Helper function to write ASCII strings
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i))
      }
    }

    // RIFF header
    writeString(pos, 'RIFF')
    pos += 4
    view.setUint32(pos, fileSize, true)
    pos += 4
    writeString(pos, 'WAVE')
    pos += 4

    // fmt chunk
    writeString(pos, 'fmt ')
    pos += 4
    view.setUint32(pos, 16, true) // chunk size
    pos += 4
    view.setUint16(pos, 1, true) // PCM format
    pos += 2
    view.setUint16(pos, channelCount, true)
    pos += 2
    view.setUint32(pos, sampleRate, true)
    pos += 4
    view.setUint32(pos, byteRate, true)
    pos += 4
    view.setUint16(pos, blockAlign, true)
    pos += 2
    view.setUint16(pos, WAV_BITS_PER_SAMPLE, true) // bits per sample
    pos += 2

    // data chunk
    writeString(pos, 'data')
    pos += 4
    view.setUint32(pos, dataSize, true)
  }

  /**
   * Parses an AEA file blob to extract header info and frame data
   * @param {Blob} blob - AEA file blob to parse
   * @returns {Promise<Object>} Parsed AEA file data
   * @returns {Object} returns.info - AEA file header information
   * @returns {Uint8Array[]} returns.frameData - Array of frame data buffers
   */
  static async parseAeaBlob(blob) {
    const buffer = await blob.arrayBuffer()
    const header = new Uint8Array(buffer.slice(0, AEA_HEADER_SIZE))
    const info = AeaFile.parseHeader(header)

    const frameData = []
    for (let i = AEA_HEADER_SIZE; i < buffer.byteLength; i += SOUND_UNIT_SIZE) {
      const frame = new Uint8Array(buffer.slice(i, i + SOUND_UNIT_SIZE))
      if (frame.length === SOUND_UNIT_SIZE) {
        frameData.push(frame)
      }
    }

    return { info, frameData }
  }

  /**
   * Creates a stream of deserialized frames from binary frame data
   * @param {Uint8Array[]} frameData - Array of binary frame data
   * @returns {Generator<Object>} Stream of deserialized frame objects
   */
  static *deserializedFrameStream(frameData) {
    for (const frame of frameData) {
      yield deserializeFrame(frame)
    }
  }

  /**
   * Assembles PCM frames into a continuous buffer
   * @param {Float64Array[]|[Float64Array, Float64Array][]} pcmFrames - Array of PCM frames
   * @param {number} channelCount - Number of audio channels
   * @returns {Float64Array} Continuous PCM buffer (interleaved for stereo)
   * @throws {Error} If unsupported channel count is provided
   */
  static assemblePcmFrames(pcmFrames, channelCount) {
    if (channelCount === 1) {
      const totalSamples = pcmFrames.reduce(
        (sum, frame) => sum + frame.length,
        0
      )
      const pcm = new Float64Array(totalSamples)
      let offset = 0
      for (const frame of pcmFrames) {
        pcm.set(frame, offset)
        offset += frame.length
      }
      return pcm
    } else if (channelCount === 2) {
      const totalSamples = pcmFrames.reduce(
        (sum, [left, right]) => sum + Math.max(left.length, right.length),
        0
      )
      const pcm = new Float64Array(totalSamples * 2)

      let pcmOffset = 0
      for (const [leftFrame, rightFrame] of pcmFrames) {
        const frameLength = Math.max(leftFrame.length, rightFrame.length)
        for (let j = 0; j < frameLength; j++) {
          pcm[pcmOffset * 2] = j < leftFrame.length ? leftFrame[j] : 0
          pcm[pcmOffset * 2 + 1] = j < rightFrame.length ? rightFrame[j] : 0
          pcmOffset++
        }
      }
      return pcm
    } else {
      throw new Error(`Unsupported channel count: ${channelCount}`)
    }
  }
}
