import { describe, it, expect } from 'vitest'
import { EncoderOptions } from '../codec/core/options'

describe('EncoderOptions', () => {
  it('should have correct default values', () => {
    const options = new EncoderOptions()
    expect(options.getValue('transientThresholdLow')).toBe(1)
    expect(options.getValue('transientThresholdMid')).toBe(1.5)
    expect(options.getValue('transientThresholdHigh')).toBe(2.0)
    expect(options.getValue('normalizationDb')).toBe(68)
  })

  it('should validate the range of a value on setting', () => {
    const options = new EncoderOptions()
    expect(() => options.setValue('transientThresholdLow', 10)).toThrow()
    expect(() => options.setValue('transientThresholdLow', 0.0)).toThrow()
    expect(() => options.setValue('normalizationDb', 50)).toThrow()
    expect(() => options.setValue('normalizationDb', 90)).toThrow()
  })

  it('should reject unknown options', () => {
    const options = new EncoderOptions()
    expect(() => options.setValue('unknownOption', 123)).toThrow()
  })

  it('should perform a batch update with setOptions', () => {
    const options = new EncoderOptions()
    options.setOptions({
      transientThresholdLow: 0.5,
      transientThresholdMid: 0.75,
      normalizationDb: 70,
    })
    expect(options.getValue('transientThresholdLow')).toBe(0.5)
    expect(options.getValue('transientThresholdMid')).toBe(0.75)
    expect(options.getValue('normalizationDb')).toBe(70)
  })

  it('should reset to default values', () => {
    const options = new EncoderOptions()
    options.setOptions({
      transientThresholdLow: 1.5,
      normalizationDb: 75,
    })
    options.reset()
    expect(options.getValue('transientThresholdLow')).toBe(1.0)
    expect(options.getValue('normalizationDb')).toBe(68)
  })
})
