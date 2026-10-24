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

/** Convert interleaved signed little-endian PCM into normalized channels. */
export function pcmBytesToChannels(bytes, bitDepth, channelCount, sampleCount) {
  if (![16, 24, 32].includes(bitDepth)) {
    throw new RangeError(`Unsupported PCM bit depth: ${bitDepth}`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const channels = Array.from(
    { length: channelCount },
    () => new Float32Array(sampleCount)
  )
  let offset = 0
  for (let sample = 0; sample < sampleCount; sample++) {
    for (const channel of channels) {
      let value
      if (bitDepth === 16) value = view.getInt16(offset, true) / 32768
      else if (bitDepth === 32) value = view.getInt32(offset, true) / 2147483648
      else {
        let integer =
          bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
        if (integer > 0x7fffff) integer -= 0x1000000
        value = integer / 8388608
      }
      channel[sample] = value
      offset += bitDepth / 8
    }
  }
  return channels
}

/** Read a RIFF/WAVE byte image. Native file I/O stays outside this boundary. */
export function parsePcmWave(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const fourCc = (offset) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (bytes.length < 12 || fourCc(0) !== 'RIFF' || fourCc(8) !== 'WAVE') {
    throw new Error('Invalid RIFF/WAVE file')
  }
  const end = view.getUint32(4, true) + 8
  if (end > bytes.length || end < 12)
    throw new Error('Truncated RIFF/WAVE file')
  let format = null
  let data = null
  for (let offset = 12; offset + 8 <= end;) {
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (start + size > end) throw new Error('Truncated WAVE chunk')
    if (fourCc(offset) === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAVE format chunk')
      format = {
        code: view.getUint16(start, true),
        channelCount: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        blockAlign: view.getUint16(start + 12, true),
        bitDepth: view.getUint16(start + 14, true),
      }
    } else if (fourCc(offset) === 'data' && data === null)
      data = bytes.subarray(start, start + size)
    offset = start + size + (size & 1)
  }
  if (!format || data === null)
    throw new Error('WAVE requires fmt and data chunks')
  const { code, channelCount, sampleRate, blockAlign, bitDepth } = format
  if (code !== 1 || ![16, 24, 32].includes(bitDepth)) {
    throw new Error('WAVE input must be signed 16, 24, or 32-bit integer PCM')
  }
  if (channelCount !== 1 && channelCount !== 2)
    throw new Error(`Unsupported channel count: ${channelCount}`)
  if (
    sampleRate < 1 ||
    blockAlign !== (channelCount * bitDepth) / 8 ||
    data.length % blockAlign !== 0
  ) {
    throw new Error('Invalid WAVE sample layout')
  }
  return {
    channels: pcmBytesToChannels(
      data,
      bitDepth,
      channelCount,
      data.length / blockAlign
    ),
    sampleRate,
    bitDepth,
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
  if (
    !Array.isArray(buffers) ||
    (buffers.length !== 1 && buffers.length !== 2) ||
    !buffers.every(
      (buffer) =>
        buffer instanceof Float32Array && buffer.length === buffers[0].length
    ) ||
    !Number.isInteger(frameSize) ||
    frameSize < 1
  ) {
    throw new RangeError(
      'ATRAC1 framing requires one or two equally sized Float32 channels and a positive integer frame size'
    )
  }
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
    const sampleCount = left.length
    for (let offset = 0; offset < sampleCount; offset += frameSize) {
      const leftFrame = new Float32Array(frameSize)
      const rightFrame = new Float32Array(frameSize)
      leftFrame.set(left.subarray(offset, offset + frameSize))
      rightFrame.set(right.subarray(offset, offset + frameSize))
      yield [leftFrame, rightFrame]
    }
    return
  }
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
 * @returns {Uint8Array}
 */
export function createPcmWaveHeader({ sampleCount, sampleRate, channels }) {
  const byteRate = sampleRate * channels * WAV_BYTES_PER_SAMPLE
  const blockAlign = channels * WAV_BYTES_PER_SAMPLE
  const dataSize = sampleCount * blockAlign
  const output = new Uint8Array(WAV_HEADER_SIZE)
  const view = new DataView(output.buffer)

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
 * @returns {Uint8Array}
 */
export function interleavePcm16(channels) {
  if (
    !Array.isArray(channels) ||
    channels.length < 1 ||
    !channels.every(
      (channel) =>
        channel instanceof Float32Array && channel.length === channels[0].length
    )
  ) {
    throw new RangeError('PCM must contain equally sized Float32 channels')
  }
  const sampleCount = channels[0].length
  const output = new Uint8Array(
    sampleCount * channels.length * WAV_BYTES_PER_SAMPLE
  )
  const view = new DataView(output.buffer)
  let offset = 0

  for (let sample = 0; sample < sampleCount; sample++) {
    for (const channel of channels) {
      view.setInt16(offset, floatToPcm16(channel[sample]), true)
      offset += WAV_BYTES_PER_SAMPLE
    }
  }
  return output
}

/**
 * Create a complete PCM WAVE byte image from planar channels.
 *
 * @param {Float32Array[]} channels
 * @param {Object} [options]
 * @param {number} [options.sampleRate=SAMPLE_RATE]
 * @returns {Uint8Array}
 */
export function createPcmWave(channels, options = {}) {
  const { sampleRate = SAMPLE_RATE } = options
  const pcm = interleavePcm16(channels)
  const sampleCount = channels[0].length
  const header = createPcmWaveHeader({
    sampleCount,
    sampleRate,
    channels: channels.length,
  })
  const output = new Uint8Array(header.length + pcm.length)
  output.set(header)
  output.set(pcm, header.length)
  return output
}
