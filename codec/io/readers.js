/**
 * Carta1 Audio Codec - File Readers
 *
 * This module provides file reading utilities for AEA format files,
 * supporting both metadata parsing and streaming frame iteration.
 */

import fs from 'fs'
import { AeaFile, deserializeFrame } from './serialization.js'
import { AEA_HEADER_SIZE, SOUND_UNIT_SIZE } from '../core/constants.js'

/**
 * AEA file reader with async iteration support for streaming frame processing
 */
export class AeaReader {
  /**
   * Create a new AEA file reader
   * @param {string} filePath - Path to the AEA file
   */
  constructor(filePath) {
    this.filePath = filePath
    this.metadata = null
  }

  /**
   * Load and parse AEA file metadata from header
   * @returns {Promise<void>}
   */
  async loadMetadata() {
    const handle = await fs.promises.open(this.filePath, 'r')
    const buffer = Buffer.alloc(AEA_HEADER_SIZE)
    await handle.read(buffer, 0, AEA_HEADER_SIZE, 0)
    await handle.close()
    this.metadata = AeaFile.parseHeader(buffer)
  }

  /**
   * Async iterator for streaming frame data
   * @yields {Object} Deserialized frame data
   */
  async *[Symbol.asyncIterator]() {
    const stream = fs.createReadStream(this.filePath, {
      start: AEA_HEADER_SIZE,
    })
    let buffer = Buffer.alloc(0)

    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= SOUND_UNIT_SIZE) {
        const frameData = buffer.slice(0, SOUND_UNIT_SIZE)
        buffer = buffer.slice(SOUND_UNIT_SIZE)
        yield deserializeFrame(frameData)
      }
    }
  }
}
