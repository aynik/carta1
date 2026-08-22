/**
 * Carta1 structured-frame syntax.
 *
 * Handles serialization and deserialization of ATRAC1 audio frames.
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
  FRAME_HEADER_BITS,
  FRAME_WORD_LENGTH_BITS,
  FRAME_SCALE_FACTOR_BITS,
} from '../core/constants.js'
import { BFU_AMOUNTS, SPECS_PER_BFU, WORD_LENGTH_BITS } from '../core/tables.js'
import { packBits, unpackBits, unpackSignedBits } from './bitstream.js'

/**
 * Serializes encoded frame data into binary format
 * @param {import('../quantization/stage.js').StructuredFrame} frameData - The encoded frame data to serialize
 * @returns {Uint8Array} Serialized frame data buffer
 */
export function serializeFrame(frameData) {
  const buffer = new Uint8Array(SOUND_UNIT_SIZE)
  const view = new DataView(buffer.buffer)

  // Pack header (16 bits)
  const bfuIndex = BFU_AMOUNTS.indexOf(frameData.nBfu)
  const header =
    ((2 - frameData.blockModes[0]) << 14) |
    ((2 - frameData.blockModes[1]) << 12) |
    ((3 - frameData.blockModes[2]) << 10) |
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
 * @returns {import('../quantization/stage.js').StructuredFrame} Deserialized frame data
 * @throws {Error} If buffer size is invalid
 */
export function deserializeFrame(buffer) {
  if (buffer.length !== SOUND_UNIT_SIZE) {
    throw new Error(`Frame must be ${SOUND_UNIT_SIZE} bytes`)
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  // Unpack header
  const header = view.getUint16(0, false)
  const blockModes = [
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
    blockModes,
  }
}
