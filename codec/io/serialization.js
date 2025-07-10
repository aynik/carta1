/**
 * Carta1 Audio Codec - Serialization Module
 *
 * Handles serialization and deserialization of ATRAC1 audio frames and AEA file format.
 * Provides functions for packing encoded frame data into binary format and unpacking
 * it back into structured data for processing.
 *
 * The module manages:
 * - Frame data serialization/deserialization with proper bit packing
 * - AEA file header creation and parsing
 * - Binary format compliance for ATRAC1 specification
 */

import {
  SOUND_UNIT_SIZE,
  BFU_AMOUNTS,
  SPECS_PER_BFU,
  AEA_HEADER_SIZE,
  AEA_MAGIC,
  AEA_TITLE_OFFSET,
  AEA_TITLE_SIZE,
  AEA_FRAME_COUNT_OFFSET,
  AEA_CHANNEL_COUNT_OFFSET,
  WORD_LENGTH_BITS,
  FRAME_HEADER_BITS,
  FRAME_WORD_LENGTH_BITS,
  FRAME_SCALE_FACTOR_BITS,
} from '../core/constants.js'
import { packBits, unpackBits, unpackSignedBits } from './bitstream.js'

/**
 * Serializes encoded frame data into binary format
 * @param {Object} frameData - The encoded frame data to serialize
 * @param {number} frameData.nBfu - Number of block floating units
 * @param {number[]} frameData.blockSizeMode - Block size mode for each band [0-2]
 * @param {Int32Array} frameData.scaleFactorIndices - Scale factor indices for each BFU
 * @param {Int32Array} frameData.wordLengthIndices - Word length indices for each BFU
 * @param {Int32Array[]} frameData.quantizedCoefficients - Quantized spectral coefficients
 * @returns {Uint8Array} Serialized frame data buffer
 */
export function serializeFrame(frameData) {
  const buffer = new Uint8Array(SOUND_UNIT_SIZE)
  const view = new DataView(buffer.buffer)

  // Pack header (16 bits)
  const bfuIndex = BFU_AMOUNTS.indexOf(frameData.nBfu)
  const header =
    ((2 - frameData.blockSizeMode[0]) << 14) |
    ((2 - frameData.blockSizeMode[1]) << 12) |
    ((3 - frameData.blockSizeMode[2]) << 10) |
    (bfuIndex << 5)

  view.setUint16(0, header, false)
  let bitPosition = FRAME_HEADER_BITS

  // Pack word lengths (4 bits each)
  for (let i = 0; i < frameData.nBfu; i++) {
    packBits(
      buffer,
      bitPosition,
      frameData.wordLengthIndices[i],
      FRAME_WORD_LENGTH_BITS
    )
    bitPosition += FRAME_WORD_LENGTH_BITS
  }

  // Pack scale factors (6 bits each)
  for (let i = 0; i < frameData.nBfu; i++) {
    packBits(
      buffer,
      bitPosition,
      frameData.scaleFactorIndices[i],
      FRAME_SCALE_FACTOR_BITS
    )
    bitPosition += FRAME_SCALE_FACTOR_BITS
  }

  // Pack quantized coefficients
  for (let i = 0; i < frameData.nBfu; i++) {
    const bitsPerSample = WORD_LENGTH_BITS[frameData.wordLengthIndices[i]]
    if (bitsPerSample > 0) {
      const coefficients = frameData.quantizedCoefficients[i]
      for (const coefficient of coefficients) {
        const value =
          coefficient < 0 ? coefficient + (1 << bitsPerSample) : coefficient
        packBits(buffer, bitPosition, value, bitsPerSample)
        bitPosition += bitsPerSample
      }
    }
  }

  // Zero padding at end
  buffer[SOUND_UNIT_SIZE - 3] = 0
  buffer[SOUND_UNIT_SIZE - 2] = 0
  buffer[SOUND_UNIT_SIZE - 1] = 0

  return buffer
}

/**
 * Deserializes binary frame data back into structured format
 * @param {Uint8Array} buffer - Binary frame data buffer
 * @returns {Object} Deserialized frame data
 * @returns {number} returns.nBfu - Number of block floating units
 * @returns {number[]} returns.blockSizeMode - Block size mode for each band
 * @returns {Int32Array} returns.scaleFactorIndices - Scale factor indices for each BFU
 * @returns {Int32Array} returns.wordLengthIndices - Word length indices for each BFU
 * @returns {Int32Array[]} returns.quantizedCoefficients - Quantized spectral coefficients
 * @throws {Error} If buffer size is invalid
 */
export function deserializeFrame(buffer) {
  if (buffer.length !== SOUND_UNIT_SIZE) {
    throw new Error(`Frame must be ${SOUND_UNIT_SIZE} bytes`)
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  // Unpack header
  const header = view.getUint16(0, false)
  const blockSizeMode = [
    2 - ((header >> 14) & 3),
    2 - ((header >> 12) & 3),
    3 - ((header >> 10) & 3),
  ]
  const bfuIndex = (header >> 5) & 7
  const nBfu = BFU_AMOUNTS[bfuIndex]

  let bitPosition = FRAME_HEADER_BITS

  // Unpack word lengths
  const wordLengthIndices = new Int32Array(nBfu)
  for (let i = 0; i < nBfu; i++) {
    wordLengthIndices[i] = unpackBits(
      buffer,
      bitPosition,
      FRAME_WORD_LENGTH_BITS
    )
    bitPosition += FRAME_WORD_LENGTH_BITS
  }

  // Unpack scale factors
  const scaleFactorIndices = new Int32Array(nBfu)
  for (let i = 0; i < nBfu; i++) {
    scaleFactorIndices[i] = unpackBits(
      buffer,
      bitPosition,
      FRAME_SCALE_FACTOR_BITS
    )
    bitPosition += FRAME_SCALE_FACTOR_BITS
  }

  // Unpack coefficients
  const quantizedCoefficients = []
  for (let i = 0; i < nBfu; i++) {
    const bitsPerSample = WORD_LENGTH_BITS[wordLengthIndices[i]]
    const bfuSize = SPECS_PER_BFU[i]
    const coefficients = new Int32Array(bfuSize)

    if (bitsPerSample > 0) {
      for (let j = 0; j < bfuSize; j++) {
        coefficients[j] = unpackSignedBits(buffer, bitPosition, bitsPerSample)
        bitPosition += bitsPerSample
      }
    }

    quantizedCoefficients.push(coefficients)
  }

  return {
    nBfu,
    scaleFactorIndices,
    wordLengthIndices,
    quantizedCoefficients,
    blockSizeMode,
  }
}

/**
 * AEA file format handler for ATRAC1 audio files
 * Manages creation and parsing of AEA file headers
 */
export class AeaFile {
  /**
   * Creates an AEA file header with the specified metadata
   * @param {string} [title=''] - Audio file title (max 255 characters)
   * @param {number} [frameCount=0] - Number of audio frames in the file
   * @param {number} [channelCount=1] - Number of audio channels (1 or 2)
   * @returns {Uint8Array} AEA file header buffer
   */
  static createHeader(title = '', frameCount = 0, channelCount = 1) {
    const header = new Uint8Array(AEA_HEADER_SIZE)
    const view = new DataView(header.buffer)

    // Magic number
    header.set(AEA_MAGIC, 0)

    // Title (null-terminated string)
    const titleBytes = new TextEncoder().encode(title)
    header.set(
      titleBytes.subarray(0, Math.min(titleBytes.length, AEA_TITLE_SIZE - 1)),
      AEA_TITLE_OFFSET
    )

    // Frame count
    view.setUint32(AEA_FRAME_COUNT_OFFSET, frameCount, true)

    // Channel count
    header[AEA_CHANNEL_COUNT_OFFSET] = channelCount

    return header
  }

  /**
   * Parses an AEA file header to extract metadata
   * @param {Uint8Array} header - AEA file header buffer
   * @returns {Object} Parsed header information
   * @returns {string} returns.title - Audio file title
   * @returns {number} returns.frameCount - Number of audio frames
   * @returns {number} returns.channelCount - Number of audio channels
   * @throws {Error} If header size is invalid or magic number doesn't match
   */
  static parseHeader(header) {
    if (header.length !== AEA_HEADER_SIZE) {
      throw new Error(`Header must be ${AEA_HEADER_SIZE} bytes`)
    }

    // Check magic number
    for (let i = 0; i < AEA_MAGIC.length; i++) {
      if (header[i] !== AEA_MAGIC[i]) {
        throw new Error('Invalid AEA file')
      }
    }

    const view = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength
    )

    // Extract title
    const titleEnd = header.indexOf(0, AEA_TITLE_OFFSET)
    const titleLength =
      titleEnd === -1 ? AEA_TITLE_SIZE : titleEnd - AEA_TITLE_OFFSET
    const title = new TextDecoder().decode(
      header.subarray(AEA_TITLE_OFFSET, AEA_TITLE_OFFSET + titleLength)
    )

    // Extract metadata
    const frameCount = view.getUint32(AEA_FRAME_COUNT_OFFSET, true)
    const channelCount = header[AEA_CHANNEL_COUNT_OFFSET]

    return { title, frameCount, channelCount }
  }
}
