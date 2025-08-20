/**
 * Carta1 Web Worker - Self-contained audio codec worker
 *
 * Provides asynchronous encoding and decoding of ATRAC1 audio format
 * in a separate thread to prevent blocking the main UI thread.
 *
 * Usage:
 *   Include this file as a web worker:
 *   new Worker('carta1-worker.min.js')
 */

import { AeaFile } from '../io/serialization.js'
import { EncoderOptions } from '../core/options.js'
import { AudioProcessor } from '../io/processor.js'
import { SAMPLE_RATE } from '../core/constants.js'

/**
 * Handle messages from the main thread
 *
 * Supported message types:
 * - 'encode': Encode PCM to ATRAC1
 * - 'decode': Decode ATRAC1 to PCM
 * - 'parseAea': Parse AEA blob metadata
 * - 'getEncoderOptions': Get default encoder options
 */
self.onmessage = async (e) => {
  const { jobId, type, pcmData, aea, options, title, blob } = e.data

  try {
    let result

    switch (type) {
      case 'encode':
        result = await encodeAtrac(pcmData, options, title)
        break
      case 'decode':
        result = await decodeAtrac(aea)
        break
      case 'parseAea':
        result = await AudioProcessor.parseAeaBlob(blob)
        break
      case 'getEncoderOptions':
        result = getEncoderOptionsMetadata()
        break
      default:
        throw new Error(`Unknown worker message type: ${type}`)
    }

    self.postMessage({ jobId, result })
  } catch (error) {
    console.error('Worker error:', error)
    self.postMessage({ jobId, error: error.message })
  }
}

/**
 * Encode PCM audio data to ATRAC1 format
 *
 * @param {Array<Float64Array>} pcmData - PCM audio data [mono] or [left, right]
 * @param {Object} options - Encoder options
 * @returns {Promise<Object>} Encoded AEA blob
 */
async function encodeAtrac(pcmData, options, title) {
  title = title ?? 'encoded by carta1'
  try {
    const audioFrames = AudioProcessor.frameBufferToFrames(pcmData)
    const channelCount = pcmData.length

    // Create encoder options from provided settings
    const encoderOptions = new EncoderOptions(options)

    const encodedFrames = AudioProcessor.encodeStream(audioFrames, {
      channelCount,
      encoderOptions,
    })

    const frameArray = await AudioProcessor.collectFrames(encodedFrames)

    const aeaBlob = await AudioProcessor.createAeaBlob(frameArray, {
      title,
      channelCount,
    })

    // Return the blob
    return { aeaBlob }
  } catch (error) {
    console.error('Worker encode error:', error)
    throw error
  }
}

/**
 * Get default encoder options metadata
 *
 * @returns {Object} Default encoder options as plain object
 */
function getEncoderOptionsMetadata() {
  const defaultOptions = new EncoderOptions()
  return defaultOptions.toObject()
}

/**
 * Decode ATRAC1 data to PCM WAV format
 *
 * @param {Object} aea - AEA data object
 * @param {Uint8Array} aea.header - AEA file header
 * @param {Array} aea.aeaData - Serialized frame data
 * @param {Object} [aea.info] - Optional metadata
 * @returns {Promise<Object>} WAV blob and decoding info
 */
async function decodeAtrac(aea) {
  const { header, aeaData, info } = aea

  // Use provided info, or fall back to header parsing, or defaults
  let decodingInfo
  if (info) {
    decodingInfo = { sampleRate: SAMPLE_RATE, ...info }
  } else if (header) {
    const headerInfo = AeaFile.parseHeader(header)
    decodingInfo = { sampleRate: SAMPLE_RATE, ...headerInfo }
  } else {
    decodingInfo = { channelCount: 2, sampleRate: SAMPLE_RATE }
  }

  const encodedFrameStream = AudioProcessor.deserializedFrameStream(aeaData)
  const decodedFrames = AudioProcessor.decodeStream(encodedFrameStream, {
    channelCount: decodingInfo.channelCount,
  })

  const pcmFrames = await AudioProcessor.collectFrames(decodedFrames)

  // Create WAV blob directly
  const wavBlob = AudioProcessor.createWavBlob(
    pcmFrames,
    decodingInfo.channelCount,
    decodingInfo.sampleRate
  )

  return { wavBlob, info: decodingInfo }
}
