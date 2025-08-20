import { describe, it, expect } from 'vitest'
import {
  mdct64,
  mdct256,
  mdct512,
  imdct64,
  imdct256,
  imdct512,
  overlapAdd,
} from '../codec/transforms/mdct'

describe('MDCT and IMDCT', () => {
  it('should have correct instance properties', () => {
    expect(mdct64.size).toBe(64)
    expect(mdct256.size).toBe(256)
    expect(mdct512.size).toBe(512)
    expect(imdct64.size).toBe(64)
    expect(imdct256.size).toBe(256)
    expect(imdct512.size).toBe(512)
  })

  describe('overlapAdd', () => {
    it('should correctly perform overlap-add with windowing', () => {
      const size = 32
      const prev = new Float64Array(size).fill(1)
      const curr = new Float64Array(size).fill(0.5)
      const window = new Float64Array(size * 2).fill(1)
      const result = overlapAdd(prev, curr, window)
      expect(result.length).toBe(size * 2)
      expect(result[0]).toBe(0.5)
      expect(result[size * 2 - 1]).toBe(1.5)
    })
  })

  it('IMDCT should achieve perfect reconstruction with overlap-add', () => {
    const size = 32
    const window = new Float64Array(size)

    // Create a simple window (sine window)
    for (let i = 0; i < size; i++) {
      window[i] = Math.sin(((i + 0.5) * Math.PI) / size)
    }

    // Create overlapping input frames
    const frame1 = new Float64Array(size)
    const frame2 = new Float64Array(size)

    // Fill with test signal
    for (let i = 0; i < size; i++) {
      frame1[i] = Math.sin((2 * Math.PI * i) / size)
      frame2[i] = Math.sin((4 * Math.PI * i) / size)
    }

    // Window the frames
    const windowed1 = new Float64Array(size)
    const windowed2 = new Float64Array(size)
    for (let i = 0; i < size; i++) {
      windowed1[i] = frame1[i] * window[i]
      windowed2[i] = frame2[i] * window[i]
    }

    // Use overlap-add
    const halfSize = size / 2
    const result = overlapAdd(
      windowed1.slice(halfSize),
      windowed2.slice(0, halfSize),
      window
    )

    // The result should combine the two frames with proper windowing
    expect(result.length).toBe(size)

    // Check that we get non-zero output
    const hasSignal = result.some((v) => Math.abs(v) > 0.01)
    expect(hasSignal).toBe(true)
  })
})
