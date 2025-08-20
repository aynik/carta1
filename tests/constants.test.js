import { describe, it, expect } from 'vitest'
import * as constants from '../codec/core/constants'

describe('Constants', () => {
  describe('SPECS_PER_BFU', () => {
    it('should sum to 512', () => {
      const sum = constants.SPECS_PER_BFU.reduce((a, b) => a + b, 0)
      expect(sum).toBe(512)
    })
  })

  describe('BFU_START_LONG', () => {
    it('should be consistent with SPECS_PER_BFU', () => {
      let cumulativeSum = 0
      for (let i = 0; i < constants.SPECS_PER_BFU.length; i++) {
        expect(constants.BFU_START_LONG[i]).toBe(cumulativeSum)
        cumulativeSum += constants.SPECS_PER_BFU[i]
      }
    })
  })

  describe('SCALE_FACTORS', () => {
    it('should follow an exponential progression', () => {
      for (let i = 0; i < constants.SCALE_FACTORS.length; i++) {
        const expected = Math.pow(2.0, i / 3.0 - 21)
        expect(constants.SCALE_FACTORS[i]).toBeCloseTo(expected)
      }
    })
  })

  describe('WINDOW_SHORT', () => {
    it('should be normalized correctly (based on sine window properties)', () => {
      // For a sine window from 0 to PI/2, the values are sin((i + 0.5) * PI / (2 * N))
      // Here N = 32, so sin((i + 0.5) * PI / 64)
      for (let i = 0; i < constants.WINDOW_SHORT.length; i++) {
        const expected = Math.sin(((i + 0.5) * Math.PI) / 64)
        expect(constants.WINDOW_SHORT[i]).toBeCloseTo(expected)
      }
    })
  })
})
