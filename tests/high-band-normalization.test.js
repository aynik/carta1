import { describe, expect, it } from 'vitest'
import { decodeAeaPcm, encodeAeaPcm } from '../codec/index'
import { BufferPool } from '../codec/state'
import { synthesizeSpectrum } from '../codec/synthesis/bands'
import {
  SAMPLES_PER_FRAME,
  STREAM_PRIMING_SAMPLES,
} from '../codec/core/constants'

/** Peak of one band's time-domain output for a single unit coefficient. */
function bandPeak(bandIndex, blockModes) {
  const coefficients = new Float32Array(512)
  coefficients[[0, 128, 256][bandIndex]] = 1
  const output = synthesizeSpectrum({ bufferPool: new BufferPool() })({
    coefficients,
    blockModes,
  })
  return Math.max(...Array.from(output[bandIndex], Math.abs))
}

describe('high band normalization', () => {
  it('applies the same short-block gain in every band', () => {
    const short = [2, 2, 3]
    const lowPeak = bandPeak(0, short)
    expect(lowPeak).toBeCloseTo(0.852951169, 6)
    expect(bandPeak(1, short)).toBeCloseTo(lowPeak, 6)
    expect(bandPeak(2, short)).toBeCloseTo(lowPeak, 6)
  })

  it('keeps high-band long and short blocks on a consistent scale', () => {
    // All bands use the same inverse-transform normalization; long and short
    // modes must remain consistent through their different window geometries.
    const ratioShort = bandPeak(2, [2, 2, 3]) / bandPeak(1, [2, 2, 3])
    const ratioLong = bandPeak(2, [0, 0, 0]) / bandPeak(1, [0, 0, 0])
    expect(Math.abs(ratioShort / ratioLong - 1)).toBeLessThan(0.02)
  })

  it('round-trips a high-frequency signal with short blocks at unity gain', async () => {
    const length = SAMPLES_PER_FRAME * 6
    const source = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      source[i] = 0.5 * Math.sin((2 * Math.PI * 15000 * i) / 44100)
    }

    const encoded = await encodeAeaPcm([source], {
      fixedBlockModes: [2, 2, 3],
    })
    const [decoded] = await decodeAeaPcm(encoded)

    // Reset changes to either the encoder or decoder alone would move this
    // by 2x, so a conservative window catches both regressions.
    const count = Math.min(source.length, decoded.length)
    let xy = 0
    let xx = 0
    for (let i = 0; i < count; i++) {
      xy += source[i] * decoded[i]
      xx += source[i] * source[i]
    }
    expect(xy / xx).toBeGreaterThan(0.9)
    expect(xy / xx).toBeLessThan(1.1)
    expect(STREAM_PRIMING_SAMPLES).toBe(266)
  })
})
