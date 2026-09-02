/**
 * Stable ATRAC1 geometry, signal, allocation, and quantization tables.
 */

import {
  MAX_WORD_LENGTH_INDEX,
  QMF_ANALYSIS_TERMS,
  QMF_BANDS,
  QMF_SYNTHESIS_DELAY_ROWS,
  QMF_SYNTHESIS_TERMS,
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

/** Sample positions read by each component of the configurable QMF analysis. */
export const QMF_ANALYSIS_SAMPLE_OFFSETS = (() => {
  const offsets = new Uint8Array(QMF_BANDS * QMF_ANALYSIS_TERMS)
  for (let term = 0; term < QMF_ANALYSIS_TERMS; term++) {
    offsets[term] = QMF_TAPS - 1 - term * QMF_BANDS
    offsets[QMF_ANALYSIS_TERMS + term] = QMF_TAPS - QMF_BANDS - term * QMF_BANDS
  }
  return offsets
})()

/** Prototype-filter coefficients in component-major QMF analysis order. */
export const QMF_ANALYSIS_FILTER_COEFFICIENTS = (() => {
  const coefficients = new Float32Array(QMF_BANDS * QMF_ANALYSIS_TERMS)
  coefficients.set(QMF_EVEN)
  coefficients.set(QMF_ODD, QMF_ANALYSIS_TERMS)
  return coefficients
})()

/** Dense modulation applied after Carta1 QMF analysis filtering. */
export const QMF_ANALYSIS_MODULATION_COEFFICIENTS = new Float32Array([
  1, 1, 1, -1,
])

/* eslint-disable no-loss-of-precision -- Float32Array applies the intended float32 rounding. */

/** Reference factors used by the optimized sixteen-band modulation path. */
export const QMF_ANALYSIS_PI_OVER_8_BUTTERFLY_SCALES = new Float32Array([
  1.8477590084075928, 0.7653668522834778, 1.8477590084075928,
  0.7653668522834778,
])

/** Reference half-angle factors used by sixteen-band modulation. */
export const QMF_ANALYSIS_HALF_BUTTERFLY_SCALES = new Float32Array([
  0.7071067690849304, 0.2071067839860916, 1.2071068286895752,
])

/** Reference odd pi/32 cosines used by sixteen-band modulation. */
export const QMF_ANALYSIS_ODD_PI_OVER_32_COSINES = new Float32Array([
  1.990369439125061, 1.913880705833435, 1.7638425827026367, 1.5460208654403687,
  1.2687865495681763, 0.9427934885025024, 0.5805693864822388,
  0.1960342824459076,
])

/** Reference odd pi/16 cosines used by sixteen-band modulation. */
export const QMF_ANALYSIS_ODD_PI_OVER_16_COSINES = new Float32Array([
  1.9615705013275146, 1.662939190864563, 1.111140489578247, 0.39018064737319946,
])

/** Reference odd pi/64 cosines used by sixteen-band modulation. */
export const QMF_ANALYSIS_ODD_PI_OVER_64_COSINES = new Float32Array([
  1.9975908994674683, 1.9783530235290527, 1.9400625228881836,
  1.8830881118774414, 1.807978630065918, 1.7154572010040283, 1.606415033340454,
  1.4819022417068481, 1.3431179523468018, 1.1913986206054688,
  1.0282055139541626, 0.8551101684570312, 0.6737797260284424,
  0.48596036434173584, 0.2934609651565552, 0.09813535213470459,
])

/* eslint-enable no-loss-of-precision */

/** Delay-row offsets read by each sample of configurable QMF synthesis. */
export const QMF_SYNTHESIS_DELAY_ROW_OFFSETS = (() => {
  const offsets = new Uint8Array(QMF_BANDS * QMF_SYNTHESIS_TERMS)
  for (let sample = 0; sample < QMF_BANDS; sample++) {
    const sampleOffset = sample * QMF_SYNTHESIS_TERMS
    for (let term = 0; term < QMF_SYNTHESIS_TERMS; term++) {
      offsets[sampleOffset + term] = QMF_SYNTHESIS_DELAY_ROWS - 1 - term
    }
  }
  return offsets
})()

/** Delay components read by each sample of configurable QMF synthesis. */
export const QMF_SYNTHESIS_DELAY_COMPONENTS = (() => {
  const components = new Uint8Array(QMF_BANDS * QMF_SYNTHESIS_TERMS)
  components.fill(1, 0, QMF_SYNTHESIS_TERMS)
  return components
})()

/** Prototype-filter coefficients in output-sample-major QMF synthesis order. */
export const QMF_SYNTHESIS_FILTER_COEFFICIENTS = (() => {
  const coefficients = new Float64Array(QMF_BANDS * QMF_SYNTHESIS_TERMS)
  coefficients.set(QMF_ODD)
  coefficients.set(QMF_EVEN, QMF_SYNTHESIS_TERMS)
  return coefficients
})()

/** Dense modulation applied before Carta1 QMF synthesis filtering. */
export const QMF_SYNTHESIS_MODULATION_COEFFICIENTS = new Float64Array([
  0.5, 0.5, 0.5, -0.5,
])

export const MDCT_BAND_CONFIGS = [
  { size: 128, windowStart: 48 },
  { size: 128, windowStart: 48 },
  { size: 256, windowStart: 112 },
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

export const INV_POWER_OF_TWO = (() => {
  const maxBits = WORD_LENGTH_BITS[MAX_WORD_LENGTH_INDEX]
  const table = new Float64Array(maxBits + 1)
  for (let bits = 0; bits <= maxBits; bits++) {
    table[bits] = Math.pow(2, -bits)
  }
  return table
})()

export const WORD_LENGTH_DELTA_BITS = (() => {
  const table = new Int32Array(MAX_WORD_LENGTH_INDEX)
  for (let i = 0; i < MAX_WORD_LENGTH_INDEX; i++) {
    table[i] = (WORD_LENGTH_BITS[i + 1] - WORD_LENGTH_BITS[i]) | 0
  }
  return table
})()

export const DISTORTION_DELTA_FACTORS = (() => {
  const table = new Float64Array(MAX_WORD_LENGTH_INDEX)
  table[0] = 2.0 - INV_POWER_OF_TWO[WORD_LENGTH_BITS[1]]
  for (let i = 1; i < MAX_WORD_LENGTH_INDEX; i++) {
    const bits1 = WORD_LENGTH_BITS[i] | 0
    const bits2 = WORD_LENGTH_BITS[i + 1] | 0
    table[i] = INV_POWER_OF_TWO[bits1] - INV_POWER_OF_TWO[bits2]
  }
  return table
})()
