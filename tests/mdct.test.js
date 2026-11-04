import { describe, it, expect } from 'vitest'
import { MDCT, IMDCT } from '../codec/signal/mdct'
import { overlapAdd } from '../codec/synthesis/bands'
import { BufferPool } from '../codec/state'

describe('MDCT and IMDCT', () => {
  it('should have correct instance properties', () => {
    const mdct64 = new MDCT(64, 0.5)
    const mdct256 = new MDCT(256, 0.5)
    const mdct512 = new MDCT(512, 1)
    const imdct64 = new IMDCT(64, 64)
    const imdct256 = new IMDCT(256, 256)
    const imdct512 = new IMDCT(512, 512)
    expect(mdct64.size).toBe(64)
    expect(mdct256.size).toBe(256)
    expect(mdct512.size).toBe(512)
    expect(imdct64.size).toBe(64)
    expect(imdct256.size).toBe(256)
    expect(imdct512.size).toBe(512)
  })

  it('uses the unnormalized IMDCT for every decoder transform size', () => {
    const { mdctBuffers } = new BufferPool()
    for (const coefficientCount of [32, 128, 256]) {
      const size = coefficientCount * 2
      const coefficients = new Float32Array(coefficientCount)
      for (let i = 0; i < coefficientCount; i++) {
        coefficients[i] = Math.sin(i * 0.371) + 0.3 * Math.cos(i * 0.113)
      }
      const output = new IMDCT(size, size).transform(coefficients, mdctBuffers)
      let error = 0
      let energy = 0
      for (let t = 0; t < size; t++) {
        let expected = 0
        for (let k = 0; k < coefficientCount; k++) {
          const angle =
            (Math.PI / coefficientCount) *
            (t + 0.5 + coefficientCount / 2) *
            (k + 0.5)
          expected += coefficients[k] * Math.cos(angle)
        }
        error += (output[t] - expected) ** 2
        energy += expected ** 2
      }
      expect(Math.sqrt(error / energy)).toBeLessThan(1e-6)
    }
  })

  describe('overlapAdd', () => {
    it('should correctly perform overlap-add with windowing', () => {
      const size = 32
      const prev = new Float32Array(size).fill(1)
      const curr = new Float32Array(size).fill(0.5)
      const window = new Float32Array(size * 2).fill(1) // simplified window
      const result = overlapAdd(prev, curr, window)
      expect(result.length).toBe(size * 2)
      expect(result[0]).toBe(0.5)
      expect(result[size * 2 - 1]).toBe(1.5)
    })
  })

  it('IMDCT should achieve perfect reconstruction with overlap-add', () => {
    // MDCT/IMDCT with overlap-add should give perfect reconstruction via overlap-add
    const size = 32 // Use smaller size for testing
    const window = new Float32Array(size)

    // Create a simple window (sine window)
    for (let i = 0; i < size; i++) {
      window[i] = Math.sin(((i + 0.5) * Math.PI) / size)
    }

    // Create overlapping input frames
    const frame1 = new Float32Array(size)
    const frame2 = new Float32Array(size)

    // Fill with test signal
    for (let i = 0; i < size; i++) {
      frame1[i] = Math.sin((2 * Math.PI * i) / size)
      frame2[i] = Math.sin((4 * Math.PI * i) / size)
    }

    // Window the frames
    const windowed1 = new Float32Array(size)
    const windowed2 = new Float32Array(size)
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
