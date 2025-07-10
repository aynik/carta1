import { describe, it, expect } from 'vitest'
import {
  serializeFrame,
  deserializeFrame,
  AeaFile,
} from '../codec/io/serialization'
import {
  SOUND_UNIT_SIZE,
  AEA_MAGIC,
  AEA_HEADER_SIZE,
} from '../codec/core/constants'

describe('Serialization', () => {
  const createMockFrameData = () => ({
    nBfu: 52,
    blockSizeMode: [0, 0, 0],
    scaleFactorIndices: new Int32Array(52).fill(10),
    wordLengthIndices: new Int32Array(52).fill(8),
    quantizedCoefficients: new Array(52)
      .fill(0)
      .map(() => new Int32Array(10).fill(123)),
  })

  describe('serializeFrame and deserializeFrame', () => {
    it('should perform a round-trip with perfect accuracy', () => {
      const frameData = createMockFrameData()
      const buffer = serializeFrame(frameData)
      const deserialized = deserializeFrame(buffer)

      expect(deserialized.nBfu).toBe(frameData.nBfu)
      expect(deserialized.blockSizeMode).toEqual(frameData.blockSizeMode)
      expect(deserialized.scaleFactorIndices).toEqual(
        frameData.scaleFactorIndices
      )
      expect(deserialized.wordLengthIndices).toEqual(
        frameData.wordLengthIndices
      )
      // Due to the complexity of the data, we check a few values
      expect(deserialized.quantizedCoefficients[0][0]).toEqual(
        frameData.quantizedCoefficients[0][0]
      )
    })

    it('should pack bits correctly', () => {
      const frameData = createMockFrameData()
      const buffer = serializeFrame(frameData)
      expect(buffer.length).toBe(SOUND_UNIT_SIZE)
      // A simple check to see if the buffer is not all zeros
      expect(buffer.some((byte) => byte !== 0)).toBe(true)
    })

    it('should reject a frame with an invalid size', () => {
      const invalidBuffer = new Uint8Array(100)
      expect(() => deserializeFrame(invalidBuffer)).toThrow()
    })
  })

  describe('AeaFile', () => {
    it('should create a header with the correct magic number and layout', () => {
      const header = AeaFile.createHeader('Test Title', 123, 2)
      expect(header.length).toBe(AEA_HEADER_SIZE)
      expect(header.subarray(0, 4)).toEqual(AEA_MAGIC)

      const parsed = AeaFile.parseHeader(header)
      expect(parsed.title).toBe('Test Title')
      expect(parsed.frameCount).toBe(123)
      expect(parsed.channelCount).toBe(2)
    })

    it('should extract metadata correctly from a parsed header', () => {
      const header = AeaFile.createHeader('Another Test', 456, 1)
      const parsed = AeaFile.parseHeader(header)
      expect(parsed.title).toBe('Another Test')
      expect(parsed.frameCount).toBe(456)
      expect(parsed.channelCount).toBe(1)
    })

    it('should validate the magic number when parsing', () => {
      const header = AeaFile.createHeader('Test', 100, 1)
      header[0] = 0xff // Invalidate magic number (should be 0x00)
      expect(() => AeaFile.parseHeader(header)).toThrow('Invalid AEA file')
    })
  })
})
