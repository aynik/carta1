import { describe, it, expect } from 'vitest'
import { throwError, pipe } from '../codec/utils'

describe('Utilities', () => {
  describe('throwError', () => {
    it('should throw an error with the specified message', () => {
      const errorMessage = 'This is a test error'
      expect(() => throwError(errorMessage)).toThrow(errorMessage)
    })
  })

  describe('pipe', () => {
    it('should compose functions correctly', () => {
      const context = {}
      const add = () => (x) => x + 1
      const multiply = () => (x) => x * 2
      const subtract = () => (x) => x - 3

      const pipeline = pipe(context, add, multiply, subtract)
      // (5 + 1) * 2 - 3 = 9
      expect(pipeline(5)).toBe(9)
    })

    it('should pass context to all stages', () => {
      const context = { value: 10 }
      const stage1 = (ctx) => (x) => x + ctx.value
      const stage2 = (ctx) => (x) => x * ctx.value

      const pipeline = pipe(context, stage1, stage2)
      // (5 + 10) * 10 = 150
      expect(pipeline(5)).toBe(150)
    })
  })
})
