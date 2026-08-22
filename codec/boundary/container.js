/**
 * Carta1 AEA container boundary.
 */

import {
  AEA_CHANNEL_COUNT_OFFSET,
  AEA_FRAME_COUNT_OFFSET,
  AEA_HEADER_SIZE,
  AEA_MAGIC,
  AEA_TITLE_OFFSET,
  AEA_TITLE_SIZE,
} from '../core/constants.js'

/**
 * AEA file-format handler.
 */
export class AeaFile {
  /**
   * Create an AEA header.
   *
   * @param {string} [title='']
   * @param {number} [frameCount=0]
   * @param {number} [channelCount=1]
   * @returns {Uint8Array}
   */
  static createHeader(title = '', frameCount = 0, channelCount = 1) {
    const header = new Uint8Array(AEA_HEADER_SIZE)
    const view = new DataView(header.buffer)
    header.set(AEA_MAGIC, 0)

    const titleBytes = new TextEncoder().encode(title)
    header.set(
      titleBytes.subarray(0, Math.min(titleBytes.length, AEA_TITLE_SIZE - 1)),
      AEA_TITLE_OFFSET
    )
    view.setUint32(AEA_FRAME_COUNT_OFFSET, frameCount, true)
    header[AEA_CHANNEL_COUNT_OFFSET] = channelCount
    return header
  }

  /**
   * Parse an AEA header.
   *
   * @param {Uint8Array} header
   * @returns {{title: string, frameCount: number, channelCount: number}}
   * @throws {Error} If the header is invalid
   */
  static parseHeader(header) {
    if (header.length !== AEA_HEADER_SIZE) {
      throw new Error(`Header must be ${AEA_HEADER_SIZE} bytes`)
    }

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
    const titleEnd = header.indexOf(0, AEA_TITLE_OFFSET)
    const titleLength =
      titleEnd === -1 ? AEA_TITLE_SIZE : titleEnd - AEA_TITLE_OFFSET
    const title = new TextDecoder().decode(
      header.subarray(AEA_TITLE_OFFSET, AEA_TITLE_OFFSET + titleLength)
    )

    return {
      title,
      frameCount: view.getUint32(AEA_FRAME_COUNT_OFFSET, true),
      channelCount: header[AEA_CHANNEL_COUNT_OFFSET],
    }
  }
}
