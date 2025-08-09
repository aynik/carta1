import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AeaReader } from '../codec/io/readers'
import fs from 'fs'
import path from 'path'
import { AeaFile, serializeFrame } from '../codec/io/serialization.js'

describe('AeaReader', () => {
  const testFilePath = path.join(__dirname, 'test.aea')

  beforeEach(() => {
    const createMockFrameData = () => ({
      nBfu: 52,
      blockModes: [0, 0, 0],
      scaleFactorIndices: new Int32Array(52).fill(10),
      wordLengthIndices: new Int32Array(52).fill(8),
      quantizedCoefficients: new Array(52)
        .fill(0)
        .map(() => new Int32Array(10).fill(123)),
    })

    const header = AeaFile.createHeader('Test AEA', 2, 1)
    const frame1 = serializeFrame(createMockFrameData())
    const frame2 = serializeFrame(createMockFrameData())

    const fileContent = Buffer.concat([header, frame1, frame2])
    fs.writeFileSync(testFilePath, fileContent)
  })

  afterEach(() => {
    fs.unlinkSync(testFilePath) // Clean up the dummy file
  })

  it('should load and parse metadata correctly', async () => {
    const reader = new AeaReader(testFilePath)
    await reader.loadMetadata()
    expect(reader.metadata.title).toBe('Test AEA')
    expect(reader.metadata.frameCount).toBe(2)
    expect(reader.metadata.channelCount).toBe(1)
  })

  it('should yield all frames via async iterator', async () => {
    const reader = new AeaReader(testFilePath)
    const frames = []
    for await (const frame of reader) {
      frames.push(frame)
    }
    expect(frames.length).toBe(2)
  })

  it('should handle partial frames (if the file is truncated)', async () => {
    const reader = new AeaReader(testFilePath)
    const truncatedBuffer = fs
      .readFileSync(testFilePath)
      .slice(0, 2048 + 212 + 100)
    fs.writeFileSync(testFilePath, truncatedBuffer)

    const frames = []
    for await (const frame of reader) {
      frames.push(frame)
    }
    expect(frames.length).toBe(1)
  })
})
