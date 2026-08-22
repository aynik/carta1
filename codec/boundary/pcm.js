/**
 * Carta1 PCM boundary conversions.
 */

import {
  SAMPLE_RATE,
  SAMPLES_PER_FRAME,
  WAV_BITS_PER_SAMPLE,
  WAV_BYTES_PER_SAMPLE,
  WAV_DATA_OFFSET,
  WAV_HEADER_SIZE,
  WAV_PCM_MAX_NEGATIVE,
  WAV_PCM_MAX_POSITIVE,
} from '../core/constants.js'

/**
 * Write a four-character code.
 *
 * @param {DataView} output
 * @param {number} offset
 * @param {string} value
 */
function writeFourCc(output, offset, value) {
  for (let i = 0; i < value.length; i++) {
    output.setUint8(offset + i, value.charCodeAt(i))
  }
}

/**
 * Join complete PCM frames into one channel.
 *
 * @param {Float32Array[]} frames
 * @returns {Float32Array}
 */
export function joinChannelFrames(frames) {
  const sampleCount = frames.reduce((total, frame) => total + frame.length, 0)
  const channel = new Float32Array(sampleCount)
  let offset = 0

  for (const frame of frames) {
    channel.set(frame, offset)
    offset += frame.length
  }
  return channel
}

/**
 * Split planar PCM buffers into complete zero-padded codec frames.
 *
 * @param {Float32Array[]} buffers
 * @param {number} [frameSize=SAMPLES_PER_FRAME]
 * @returns {Generator<Float32Array>|Generator<[Float32Array, Float32Array]>}
 * @throws {Error} If the channel count is unsupported
 */
export function* frameBufferToFrames(buffers, frameSize = SAMPLES_PER_FRAME) {
  if (buffers.length === 1) {
    const [left] = buffers
    for (let offset = 0; offset < left.length; offset += frameSize) {
      const frame = new Float32Array(frameSize)
      frame.set(left.subarray(offset, offset + frameSize))
      yield frame
    }
    return
  }

  if (buffers.length === 2) {
    const [left, right] = buffers
    const sampleCount = Math.max(left.length, right.length)
    for (let offset = 0; offset < sampleCount; offset += frameSize) {
      const leftFrame = new Float32Array(frameSize)
      const rightFrame = new Float32Array(frameSize)
      leftFrame.set(left.subarray(offset, offset + frameSize))
      rightFrame.set(right.subarray(offset, offset + frameSize))
      yield [leftFrame, rightFrame]
    }
    return
  }

  throw new Error(`Unsupported channel count: ${buffers.length}`)
}

/**
 * Convert one normalized sample to signed PCM16.
 *
 * @param {number} sample
 * @returns {number}
 */
export function floatToPcm16(sample) {
  const clipped = Math.max(-1, Math.min(1, sample))
  return clipped < 0
    ? clipped * WAV_PCM_MAX_NEGATIVE
    : clipped * WAV_PCM_MAX_POSITIVE
}

/**
 * Create a PCM WAVE header.
 *
 * @param {Object} options
 * @param {number} options.sampleCount
 * @param {number} options.sampleRate
 * @param {number} options.channels
 * @returns {ArrayBuffer}
 */
export function createPcmWaveHeader({ sampleCount, sampleRate, channels }) {
  const byteRate = sampleRate * channels * WAV_BYTES_PER_SAMPLE
  const blockAlign = channels * WAV_BYTES_PER_SAMPLE
  const dataSize = sampleCount * blockAlign
  const output = new ArrayBuffer(WAV_HEADER_SIZE)
  const view = new DataView(output)

  writeFourCc(view, 0, 'RIFF')
  view.setUint32(4, WAV_DATA_OFFSET + dataSize, true)
  writeFourCc(view, 8, 'WAVE')
  writeFourCc(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, WAV_BITS_PER_SAMPLE, true)
  writeFourCc(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  return output
}

/**
 * Interleave planar normalized channels as PCM16.
 *
 * @param {Float32Array[]} channels
 * @returns {ArrayBuffer}
 */
export function interleavePcm16(channels) {
  const sampleCount = Math.max(...channels.map((channel) => channel.length))
  const output = new ArrayBuffer(
    sampleCount * channels.length * WAV_BYTES_PER_SAMPLE
  )
  const view = new DataView(output)
  let offset = 0

  for (let sample = 0; sample < sampleCount; sample++) {
    for (const channel of channels) {
      view.setInt16(offset, floatToPcm16(channel[sample] ?? 0), true)
      offset += WAV_BYTES_PER_SAMPLE
    }
  }
  return output
}

/**
 * Create a PCM WAVE blob from planar channels.
 *
 * @param {Float32Array[]} channels
 * @param {Object} [options]
 * @param {number} [options.sampleRate=SAMPLE_RATE]
 * @returns {Blob}
 */
export function createPcmWave(channels, options = {}) {
  const { sampleRate = SAMPLE_RATE } = options
  const sampleCount = Math.max(...channels.map((channel) => channel.length))
  const header = createPcmWaveHeader({
    sampleCount,
    sampleRate,
    channels: channels.length,
  })
  return new Blob([header, interleavePcm16(channels)], { type: 'audio/wav' })
}
