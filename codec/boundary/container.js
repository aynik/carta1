/**
 * Carta1 AEA container boundary.
 */

import {
  AEA_CHANNEL_COUNT_OFFSET,
  AEA_FRAME_COUNT_OFFSET,
  AEA_HEADER_SIZE,
  AEA_PRIMING_SAMPLE_COUNT_OFFSET,
  AEA_SOURCE_SAMPLE_COUNT_OFFSET,
  AEA_TITLE_OFFSET,
  AEA_TITLE_SIZE,
  STREAM_PRIMING_SAMPLES,
} from '../core/constants.js'
import { AEA_MAGIC } from '../core/tables.js'

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
   * @param {number} [sampleCount=0]
   * @param {number} [primingSampleCount=STREAM_PRIMING_SAMPLES]
   * @returns {Uint8Array}
   */
  static createHeader(
    title = '',
    frameCount = 0,
    channelCount = 1,
    sampleCount = 0,
    primingSampleCount = STREAM_PRIMING_SAMPLES
  ) {
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
    view.setUint32(
      AEA_PRIMING_SAMPLE_COUNT_OFFSET,
      primingSampleCount >>> 0,
      true
    )
    view.setUint32(AEA_SOURCE_SAMPLE_COUNT_OFFSET, sampleCount >>> 0, true)
    return header
  }

  /**
   * Parse an AEA header.
   *
   * @param {Uint8Array} header
   * @returns {object} Container metadata.
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
      primingSampleCount: view.getUint32(AEA_PRIMING_SAMPLE_COUNT_OFFSET, true),
      sampleCount: view.getUint32(AEA_SOURCE_SAMPLE_COUNT_OFFSET, true),
    }
  }
}
