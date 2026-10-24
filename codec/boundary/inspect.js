/** Shared JSON inspection for the Node and native hosts. */
import { AeaFile } from './container.js'
import { deserializeFrame } from '../syntax/frame.js'
import { AEA_HEADER_SIZE, SOUND_UNIT_SIZE } from '../core/constants.js'

export function inspectAea(bytes, inputFile, onFrame = () => {}) {
  const stats = { size: bytes.length }
  const headerBuffer = bytes.subarray(0, AEA_HEADER_SIZE)
  let metadata
  try {
    metadata = AeaFile.parseHeader(headerBuffer)
  } catch (err) {
    throw new Error(`Invalid AEA header: ${err.message}`)
  }
  const frameCount = Math.floor(
    (bytes.length - AEA_HEADER_SIZE) / SOUND_UNIT_SIZE
  )
  const dump = {
    file: {
      path: inputFile,
      size: stats.size,
      headerSize: AEA_HEADER_SIZE,
      dataSize: stats.size - AEA_HEADER_SIZE,
      expectedDataSize: frameCount * SOUND_UNIT_SIZE,
      sizeDifference:
        stats.size - AEA_HEADER_SIZE - frameCount * SOUND_UNIT_SIZE,
    },
    header: {
      magic: Array.from(headerBuffer.slice(0, 4))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' '),
      title: metadata.title,
      frameCount: metadata.frameCount,
      channelCount: metadata.channelCount,
      framesPerChannel: metadata.frameCount / metadata.channelCount,
      duration: ((metadata.frameCount / metadata.channelCount) * 512) / 44100,
    },
    frames: [],
  }

  let offset = AEA_HEADER_SIZE
  for (let i = 0; i < frameCount; i++) {
    const frameBuffer = bytes.subarray(offset, offset + SOUND_UNIT_SIZE)

    try {
      const frame = deserializeFrame(frameBuffer)
      const frameInfo = {
        index: i,
        offset: offset,
        offsetHex: '0x' + offset.toString(16),
        nBfu: frame.nBfu,
        blockModes: frame.blockModes,
        scaleFactorIndices: Array.from(frame.scaleFactorIndices),
        wordLengthIndices: Array.from(frame.wordLengthIndices),
        hasNonZeroScaleFactors: frame.scaleFactorIndices.some((sf) => sf > 0),
        hasNonZeroWordLengths: frame.wordLengthIndices.some((wl) => wl > 0),
        hasCoefficients: frame.quantizedCoefficients.some(
          (coeffs) => coeffs && coeffs.some((c) => c !== 0)
        ),
      }

      // Include full coefficient data for first few frames only
      if (i < 3 || i === frameCount - 1) {
        frameInfo.quantizedCoefficients = frame.quantizedCoefficients.map(
          (coeffs) => (coeffs ? Array.from(coeffs) : null)
        )
      }

      dump.frames.push(frameInfo)
    } catch (err) {
      dump.frames.push({
        index: i,
        offset: offset,
        offsetHex: '0x' + offset.toString(16),
        error: err.message,
      })
    }

    onFrame()
    offset += SOUND_UNIT_SIZE
  }
  // Add summary statistics
  dump.summary = {
    totalFrames: frameCount,
    validFrames: dump.frames.filter((f) => !f.error).length,
    errorFrames: dump.frames.filter((f) => f.error).length,
    silentFrames: dump.frames.filter(
      (f) => !f.error && !f.hasNonZeroScaleFactors && !f.hasNonZeroWordLengths
    ).length,
    activeFrames: dump.frames.filter(
      (f) => !f.error && (f.hasNonZeroScaleFactors || f.hasNonZeroWordLengths)
    ).length,
  }

  return dump
}
