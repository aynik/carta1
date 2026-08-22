import { describe, it, expect } from 'vitest'
import * as tables from '../codec/core/tables'

describe('Constants', () => {
  describe('SPECS_PER_BFU', () => {
    it('should sum to 512', () => {
      const sum = tables.SPECS_PER_BFU.reduce((a, b) => a + b, 0)
      expect(sum).toBe(512)
    })
  })

  describe('BFU_START_LONG', () => {
    it('should be consistent with SPECS_PER_BFU', () => {
      let cumulativeSum = 0
      for (let i = 0; i < tables.SPECS_PER_BFU.length; i++) {
        expect(tables.BFU_START_LONG[i]).toBe(cumulativeSum)
        cumulativeSum += tables.SPECS_PER_BFU[i]
      }
    })
  })

  describe('SCALE_FACTORS', () => {
    it('should follow an exponential progression', () => {
      for (let i = 0; i < tables.SCALE_FACTORS.length; i++) {
        const expected = Math.pow(2.0, i / 3.0 - 21)
        expect(tables.SCALE_FACTORS[i]).toBeCloseTo(expected)
      }
    })
  })

  describe('WINDOW_SHORT', () => {
    it('should be normalized correctly (based on sine window properties)', () => {
      // For a sine window from 0 to PI/2, the values are sin((i + 0.5) * PI / (2 * N))
      // Here N = 32, so sin((i + 0.5) * PI / 64)
      for (let i = 0; i < tables.WINDOW_SHORT.length; i++) {
        const expected = Math.sin(((i + 0.5) * Math.PI) / 64)
        expect(tables.WINDOW_SHORT[i]).toBeCloseTo(expected)
      }
    })
  })
})
