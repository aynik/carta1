/**
 * Carta1 Audio Codec - Encoder Options
 *
 * This module provides configuration management for the ATRAC1 encoder,
 * including parameter validation and metadata for UI controls.
 */

/**
 * Configuration options for the ATRAC1 encoder
 */
class EncoderOptions {
  /**
   * Create a new EncoderOptions instance
   * @param {Object} options - Initial option values
   */
  constructor(options = {}) {
    this.values = {
      transientThresholdLow: 1.0,
      transientThresholdMid: 1.5,
      transientThresholdHigh: 2.0,
    }

    this.metadata = {
      transientThresholdLow: {
        default: this.values.transientThresholdLow,
        name: 'Low Band Transient Threshold',
        description:
          'Controls the transient detection threshold for the low frequency band (0-5.5kHz). Lower values make detection more sensitive, triggering short blocks more easily. Higher values require stronger transients.',
        range: [0.01, 2],
        step: 0.01,
      },
      transientThresholdMid: {
        default: this.values.transientThresholdMid,
        name: 'Mid Band Transient Threshold',
        description:
          'Controls the transient detection threshold for the mid frequency band (5.5-11kHz). Lower values make detection more sensitive, triggering short blocks more easily. Higher values require stronger transients.',
        range: [0.01, 3],
        step: 0.01,
      },
      transientThresholdHigh: {
        default: this.values.transientThresholdHigh,
        name: 'High Band Transient Threshold',
        description:
          'Controls the transient detection threshold for the high frequency band (11-22kHz). Lower values make detection more sensitive, triggering short blocks more easily. Higher values require stronger transients.',
        range: [0.01, 4],
        step: 0.01,
      },
    }

    // Apply user-provided options
    if (options) {
      this.setOptions(options)
    }
  }

  /**
   * Set multiple options at once
   * @param {Object} options - Object containing option key-value pairs
   */
  setOptions(options) {
    for (const [key, value] of Object.entries(options)) {
      if (key in this.values) {
        this.setValue(key, value)
      }
    }
  }

  /**
   * Set a single option value with validation
   * @param {string} key - Option key
   * @param {*} value - Option value
   * @throws {Error} If key is unknown or value is out of range
   */
  setValue(key, value) {
    if (!(key in this.metadata)) {
      throw new Error(`Unknown option: ${key}`)
    }

    const meta = this.metadata[key]
    const [min, max] = meta.range

    if (value < min || value > max) {
      throw new Error(
        `Value for ${key} must be between ${min} and ${max}, got ${value}`
      )
    }

    this.values[key] = value
  }

  /**
   * Get the value of an option
   * @param {string} key - Option key
   * @returns {*} Option value
   * @throws {Error} If key is unknown
   */
  getValue(key) {
    if (!(key in this.values)) {
      throw new Error(`Unknown option: ${key}`)
    }
    return this.values[key]
  }

  get transientThresholdLow() {
    return this.values.transientThresholdLow
  }

  get transientThresholdMid() {
    return this.values.transientThresholdMid
  }

  get transientThresholdHigh() {
    return this.values.transientThresholdHigh
  }

  getMetadata(key) {
    return this.metadata[key]
  }

  getAllMetadata() {
    return { ...this.metadata }
  }

  reset() {
    for (const [key, meta] of Object.entries(this.metadata)) {
      this.values[key] = meta.default
    }
  }

  toObject() {
    return {
      values: { ...this.values },
      metadata: { ...this.metadata },
    }
  }
}

export { EncoderOptions }
