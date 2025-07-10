/**
 * Carta1 Audio Codec - Bitstream Operations
 *
 * This module provides low-level bitstream packing and unpacking operations
 * for reading and writing ATRAC1 frame data with bit-level precision.
 */

/**
 * Pack bits into a buffer at a specific bit position
 * @param {Uint8Array} buffer - Destination buffer
 * @param {number} bitPosition - Bit position to start writing at
 * @param {number} value - Value to pack
 * @param {number} bitCount - Number of bits to pack
 */
export function packBits(buffer, bitPosition, value, bitCount) {
  if (bitCount === 0) return

  let byteIndex = Math.floor(bitPosition / 8)
  let bitOffset = bitPosition % 8

  value &= (1 << bitCount) - 1

  let bitsWritten = 0
  while (bitsWritten < bitCount && byteIndex < buffer.length) {
    const bitsAvailable = 8 - bitOffset
    const bitsToWrite = Math.min(bitCount - bitsWritten, bitsAvailable)

    const shift = bitCount - bitsWritten - bitsToWrite
    const valueBits = (value >> shift) & ((1 << bitsToWrite) - 1)

    const mask = ((1 << bitsToWrite) - 1) << (bitsAvailable - bitsToWrite)
    buffer[byteIndex] =
      (buffer[byteIndex] & ~mask) | (valueBits << (bitsAvailable - bitsToWrite))

    bitsWritten += bitsToWrite
    byteIndex++
    bitOffset = 0
  }
}

/**
 * Unpack bits from a buffer at a specific bit position
 * @param {Uint8Array} buffer - Source buffer
 * @param {number} bitPosition - Bit position to start reading from
 * @param {number} bitCount - Number of bits to unpack
 * @returns {number} Unpacked unsigned value
 */
export function unpackBits(buffer, bitPosition, bitCount) {
  if (bitCount === 0) return 0

  let byteIndex = Math.floor(bitPosition / 8)
  let bitOffset = bitPosition % 8
  let value = 0

  for (let bitsRead = 0; bitsRead < bitCount && byteIndex < buffer.length; ) {
    const bitsAvailable = 8 - bitOffset
    const bitsToRead = Math.min(bitCount - bitsRead, bitsAvailable)

    const mask = (1 << bitsToRead) - 1
    const bits = (buffer[byteIndex] >> (bitsAvailable - bitsToRead)) & mask

    value = (value << bitsToRead) | bits
    bitsRead += bitsToRead
    byteIndex++
    bitOffset = 0
  }

  return value
}

/**
 * Unpack signed bits from a buffer at a specific bit position
 * @param {Uint8Array} buffer - Source buffer
 * @param {number} bitPosition - Bit position to start reading from
 * @param {number} bitCount - Number of bits to unpack
 * @returns {number} Unpacked signed value (two's complement)
 */
export function unpackSignedBits(buffer, bitPosition, bitCount) {
  const value = unpackBits(buffer, bitPosition, bitCount)
  const signBit = 1 << (bitCount - 1)
  return value >= signBit ? value - (1 << bitCount) : value
}
