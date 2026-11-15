/**
 * Stable ATRAC1 geometry, signal, allocation, and quantization tables.
 */

import {
  EAR_SENSITIVITY_FLOOR_DB,
  MAX_BFU_SIZE,
  MAX_WORD_LENGTH_INDEX,
  MDCT_SIZE_LONG_HIGH,
  MDCT_SIZE_LONG_LOW_MID,
  NUM_BFUS,
  NUM_WORD_LENGTHS,
  QMF_TAPS,
} from './constants.js'

export const AEA_MAGIC = new Uint8Array([0x00, 0x08, 0x00, 0x00])

export const SPECS_PER_BFU = new Int32Array([
  8, 8, 8, 8, 4, 4, 4, 4, 8, 8, 8, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7,
  7, 7, 9, 9, 9, 9, 10, 10, 10, 10, 12, 12, 12, 12, 12, 12, 12, 12, 20, 20, 20,
  20, 20, 20, 20, 20,
])

export const BFU_AMOUNTS = new Int32Array([20, 28, 32, 36, 40, 44, 48, 52])
export const BFU_BAND_BOUNDARIES = new Int32Array([20, 36, 52])

export const BFU_START_LONG = new Int32Array([
  0, 8, 16, 24, 32, 36, 40, 44, 48, 56, 64, 72, 80, 86, 92, 98, 104, 110, 116,
  122, 128, 134, 140, 146, 152, 159, 166, 173, 180, 189, 198, 207, 216, 226,
  236, 246, 256, 268, 280, 292, 304, 316, 328, 340, 352, 372, 392, 412, 432,
  452, 472, 492,
])

export const BFU_START_SHORT = new Int32Array([
  0, 32, 64, 96, 8, 40, 72, 104, 12, 44, 76, 108, 20, 52, 84, 116, 26, 58, 90,
  122, 128, 160, 192, 224, 134, 166, 198, 230, 141, 173, 205, 237, 150, 182,
  214, 246, 256, 288, 320, 352, 384, 416, 448, 480, 268, 300, 332, 364, 396,
  428, 460, 492,
])

export const WINDOW_SHORT = (() => {
  const table = new Float64Array(32)
  for (let i = 0; i < 32; i++) {
    table[i] = Math.sin(((i + 0.5) * Math.PI) / 64)
  }
  return table
})()

export const QMF_COEFFS = new Float32Array([
  -0.00001461907, -0.00009205479, -0.000056157569, 0.00030117269, 0.0002422519,
  -0.00085293897, -0.0005205574, 0.0020340169, 0.00078333891, -0.0042153862,
  -0.00075614988, 0.0078402944, -0.000061169922, -0.01344162, 0.0024626821,
  0.021736089, -0.007801671, -0.034090221, 0.01880949, 0.054326009,
  -0.043596379, -0.099384367, 0.13207909, 0.46424159,
])

export const QMF_WINDOW = (() => {
  const window = new Float32Array(QMF_TAPS)
  for (let i = 0; i < 24; i++) {
    window[i] = QMF_COEFFS[i] * 2.0
    window[47 - i] = QMF_COEFFS[i] * 2.0
  }
  return window
})()

export const QMF_EVEN = (() => {
  const even = new Float32Array(24)
  for (let i = 0; i < 24; i++) {
    even[i] = QMF_WINDOW[i * 2]
  }
  return even
})()

export const QMF_ODD = (() => {
  const odd = new Float32Array(24)
  for (let i = 0; i < 24; i++) {
    odd[i] = QMF_WINDOW[i * 2 + 1]
  }
  return odd
})()

// Band geometry and encoder-side analysis gains.
export const MDCT_BAND_CONFIGS = [
  {
    size: 128,
    longMdctSize: MDCT_SIZE_LONG_LOW_MID,
    windowStart: 48,
    analysisScale: 0.5,
  },
  {
    size: 128,
    longMdctSize: MDCT_SIZE_LONG_LOW_MID,
    windowStart: 48,
    analysisScale: 0.5,
  },
  {
    size: 256,
    longMdctSize: MDCT_SIZE_LONG_HIGH,
    windowStart: 112,
    analysisScale: 1,
  },
]

export const WORD_LENGTH_BITS = new Int32Array([
  0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
])

export const SCALE_FACTORS = (() => {
  const table = new Float64Array(64)
  for (let i = 0; i < 64; i++) {
    table[i] = Math.pow(2.0, i / 3.0 - 21)
  }
  return table
})()

/** Simultaneous upward masking spread across adjacent perceptual units. */
export const SPREAD_UP = new Float64Array([
  1.0, 0.03162277660168379, 0.001, 0.00003162277660168379,
])

/** Simultaneous downward masking spread across adjacent perceptual units. */
export const SPREAD_DOWN = new Float64Array([
  1.0, 0.005011872336272725, 0.000019952623149688796,
])

/** Maximum signed quantizer code per word-length index. */
export const QUANTIZER_RANGES = (() => {
  const table = new Int32Array(NUM_WORD_LENGTHS)
  for (let wordLength = 1; wordLength <= MAX_WORD_LENGTH_INDEX; wordLength++) {
    const bits = WORD_LENGTH_BITS[wordLength]
    table[wordLength] = (1 << (bits - 1)) - 1
  }
  return table
})()

/** Outer-bin peak ratio where lowering scale-factor index by 1 reduces MSE. */
export const SCALE_FACTOR_TRIM_RATIOS = (() => {
  const table = new Float64Array(NUM_WORD_LENGTHS)
  for (let wordLength = 1; wordLength <= MAX_WORD_LENGTH_INDEX; wordLength++) {
    const quantizerRange = QUANTIZER_RANGES[wordLength]
    table[wordLength] = (2.0 * quantizerRange) / (2.0 * quantizerRange + 1.0)
  }
  return table
})()

/** Reciprocal natural log of BFU spectral width for tonality normalization. */
export const INVERSE_LOG_BFU_SIZES = (() => {
  const table = new Float64Array(MAX_BFU_SIZE + 1)
  for (let size = 2; size <= MAX_BFU_SIZE; size++) {
    table[size] = 1.0 / Math.log(size)
  }
  return table
})()

/** Bounded outer/middle-ear sensitivity weights for long-block BFUs. */
export const EAR_WEIGHT_LONG = (() => {
  const table = new Float64Array(NUM_BFUS)
  for (let unit = 0; unit < NUM_BFUS; unit++) {
    const centerBin = BFU_START_LONG[unit] + SPECS_PER_BFU[unit] * 0.5
    const frequencyKhz = Math.max(0.05, (centerBin / 512.0) * 22.05)
    const weightDb = Math.max(
      EAR_SENSITIVITY_FLOOR_DB,
      -0.6 * 3.64 * Math.pow(frequencyKhz, -0.8) +
        6.5 * Math.exp(-0.6 * (frequencyKhz - 3.3) * (frequencyKhz - 3.3)) -
        1e-3 * Math.pow(frequencyKhz, 3.6)
    )
    table[unit] = Math.pow(10.0, weightDb / 10.0)
  }
  return table
})()

/** Bounded outer/middle-ear sensitivity weights for short-block BFUs. */
export const EAR_WEIGHT_SHORT = (() => {
  const table = new Float64Array(NUM_BFUS)
  const lowOffsets = new Int32Array([0, 8, 12, 20, 26])
  const midOffsets = new Int32Array([0, 6, 13, 22])
  const highOffsets = new Int32Array([0, 12])
  for (let unit = 0; unit < NUM_BFUS; unit++) {
    let frequencyKhz = 0.05
    if (unit < 20) {
      const frequencyGroup = unit >> 2
      frequencyKhz = Math.max(
        0.05,
        ((lowOffsets[frequencyGroup] + SPECS_PER_BFU[unit] * 0.5) / 32.0) *
          5.5125
      )
    } else if (unit < 36) {
      const frequencyGroup = (unit - 20) >> 2
      frequencyKhz =
        5.5125 +
        ((midOffsets[frequencyGroup] + SPECS_PER_BFU[unit] * 0.5) / 32.0) *
          5.5125
    } else {
      const frequencyGroup = (unit - 36) >> 3
      frequencyKhz =
        11.025 +
        ((highOffsets[frequencyGroup] + SPECS_PER_BFU[unit] * 0.5) / 32.0) *
          11.025
    }
    const weightDb = Math.max(
      EAR_SENSITIVITY_FLOOR_DB,
      -0.6 * 3.64 * Math.pow(frequencyKhz, -0.8) +
        6.5 * Math.exp(-0.6 * (frequencyKhz - 3.3) * (frequencyKhz - 3.3)) -
        1e-3 * Math.pow(frequencyKhz, 3.6)
    )
    table[unit] = Math.pow(10.0, weightDb / 10.0)
  }
  return table
})()
