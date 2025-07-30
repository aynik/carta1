/**
 * Carta1 Audio Codec - Core Constants
 */

// Audio format
export const SAMPLE_RATE = 44100
export const SAMPLES_PER_FRAME = 512
export const FRAME_RATE = SAMPLE_RATE / SAMPLES_PER_FRAME
export const CODEC_DELAY = 266

// AEA file format
export const AEA_MAGIC = new Uint8Array([0x00, 0x08, 0x00, 0x00])
export const AEA_HEADER_SIZE = 2048
export const AEA_TITLE_OFFSET = 4
export const AEA_TITLE_SIZE = 256
export const AEA_FRAME_COUNT_OFFSET = 260
export const AEA_CHANNEL_COUNT_OFFSET = 264

// Frame structure
export const SOUND_UNIT_SIZE = 212
export const FRAME_BITS = SOUND_UNIT_SIZE * 8
export const FRAME_OVERHEAD_BITS = 40
export const BITRATE_PER_CHANNEL = SOUND_UNIT_SIZE * FRAME_RATE * 8

// BFU (Block Floating Unit) configuration
export const NUM_BFUS = 52
export const MAX_BFU_SIZE = 20
export const BITS_PER_BFU_METADATA = 10

export const SPECS_PER_BFU = new Int32Array([
  8, 8, 8, 8, 4, 4, 4, 4, 8, 8, 8, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7,
  7, 7, 9, 9, 9, 9, 10, 10, 10, 10, 12, 12, 12, 12, 12, 12, 12, 12, 20, 20, 20,
  20, 20, 20, 20, 20,
])

export const BFU_AMOUNTS_COUNT = 8
export const BFU_AMOUNTS = new Int32Array([20, 28, 32, 36, 40, 44, 48, 52])
export const BFU_BAND_BOUNDARIES = new Int32Array([20, 36, 52])

// BFU center frequencies (Hz)
export const BFU_FREQUENCIES = new Float32Array([
  172.3, 516.8, 861.3, 1205.9, 1464.3, 1636.5, 1808.8, 1981.1, 2239.5, 2584.0,
  2928.5, 3273.0, 3574.5, 3832.9, 4091.3, 4349.7, 4608.1, 4866.5, 5124.9,
  5383.3, 5641.7, 5900.1, 6158.5, 6416.9, 6696.8, 6998.3, 7299.8, 7601.2,
  7945.8, 8333.3, 8720.9, 9108.5, 9517.7, 9948.3, 10379.0, 10809.7, 11283.4,
  11800.2, 12317.0, 12833.8, 13350.6, 13867.4, 14384.2, 14901.0, 15590.0,
  16451.4, 17312.7, 18174.0, 19035.4, 19896.7, 20758.0, 21619.3,
])

// BFU start positions
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

// Transform sizes
export const MDCT_SIZE_SHORT = 64
export const MDCT_SIZE_MID = 256
export const MDCT_SIZE_LONG = 512

// Window functions
export const WINDOW_SHORT = (() => {
  const table = new Float32Array(32)
  for (let i = 0; i < 32; i++) {
    table[i] = Math.sin(((i + 0.5) * Math.PI) / 64)
  }
  return table
})()

// QMF configuration
export const QMF_TAPS = 48
export const QMF_DELAY = 46
export const QMF_HIGH_BAND_DELAY = 39

// QMF prototype filter coefficients
export const QMF_COEFFS = new Float32Array([
  -0.00001461907, -0.00009205479, -0.000056157569, 0.00030117269, 0.0002422519,
  -0.00085293897, -0.0005205574, 0.0020340169, 0.00078333891, -0.0042153862,
  -0.00075614988, 0.0078402944, -0.000061169922, -0.01344162, 0.0024626821,
  0.021736089, -0.007801671, -0.034090221, 0.01880949, 0.054326009,
  -0.043596379, -0.099384367, 0.13207909, 0.46424159,
])

// QMF window function
export const QMF_WINDOW = (() => {
  const window = new Float32Array(QMF_TAPS)
  for (let i = 0; i < 24; i++) {
    window[i] = QMF_COEFFS[i] * 2.0
    window[47 - i] = QMF_COEFFS[i] * 2.0
  }
  return window
})()

// QMF even/odd taps for optimization
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

// Bit allocation
export const INTERPOLATION_COMPENSATION_FACTOR = 0.25

// Quantization
export const MAX_WORD_LENGTH_INDEX = 15
export const WORD_LENGTH_BITS = new Int32Array([
  0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
])
export const QUANT_DISTORTION_TABLE = (() => {
  const table = new Float32Array(MAX_WORD_LENGTH_INDEX + 1)
  table[0] = 1.0
  for (let wl = 1; wl <= MAX_WORD_LENGTH_INDEX; wl++) {
    const bitsPerSample = WORD_LENGTH_BITS[wl]
    const quantRange = (1 << (bitsPerSample - 1)) - 1
    table[wl] = 1.0 / (12.0 * quantRange * quantRange)
  }
  return table
})()
export const DISTORTION_DELTA_DB = (() => {
  const table = new Float32Array(MAX_WORD_LENGTH_INDEX)
  for (let i = 0; i < MAX_WORD_LENGTH_INDEX; i++) {
    table[i] =
      10 *
      Math.log10(
        QUANT_DISTORTION_TABLE[i + 1] / (QUANT_DISTORTION_TABLE[i] || 1.0)
      )
  }
  return table
})()
export const SCALE_FACTORS = (() => {
  const table = new Float32Array(64)
  for (let i = 0; i < 64; i++) {
    table[i] = Math.pow(2.0, i / 3.0 - 21)
  }
  return table
})()

// Psychoacoustic model
export const BARK_SCALE = (() => {
  const table = new Float32Array(NUM_BFUS)
  for (let i = 0; i < NUM_BFUS; i++) {
    const freq = BFU_FREQUENCIES[i]
    table[i] =
      13.0 * Math.atan(0.00076 * freq) + 3.5 * Math.atan((freq / 7500) ** 2)
  }
  return table
})()

export const SPREADING_MATRIX = (() => {
  const matrix = new Float32Array(NUM_BFUS * NUM_BFUS)
  for (let masker = 0; masker < NUM_BFUS; masker++) {
    for (let masked = 0; masked < NUM_BFUS; masked++) {
      const distance = BARK_SCALE[masker] - BARK_SCALE[masked]
      let spreading = -100.0

      if (distance >= -3.0 && distance < -1.0) {
        spreading = 17.0 * (distance + 3.0) - 70.0
      } else if (distance >= -1.0 && distance < 0) {
        spreading = 36.0 * distance
      } else if (distance >= 0 && distance < 1.0) {
        spreading = -27.0 * distance
      } else if (distance >= 1.0 && distance < 8.0) {
        spreading = -(distance - 1.0) * 4.0 - 27.0
      }

      matrix[masker * NUM_BFUS + masked] = spreading
    }
  }
  return matrix
})()

// ISO/IEC 11172-3:1993 Psychoacoustic Model Constants
export const PSYMODEL_MIN_POWER_DB = -200
export const PSYMODEL_FFT_SIZE = 2048

// Pre-computes lookup tables for resampling the MDCT power spectrum into a PSD.
// For each PSD bin, these tables provide the two source MDCT indices and the
// linear interpolation weight needed to calculate the final power value.
export const [
  PSYMODEL_PSD_SOURCE_IDX0,
  PSYMODEL_PSD_SOURCE_IDX1,
  PSYMODEL_PSD_INTERP_WEIGHT,
] = (() => {
  const half = PSYMODEL_FFT_SIZE >>> 1
  const sizeMinus1 = PSYMODEL_FFT_SIZE - 1
  const halfDiv2 = half / 2
  const scale = sizeMinus1 / half

  const idx0 = new Uint16Array(half + 1)
  const idx1 = new Uint16Array(half + 1)
  const w1 = new Float32Array(half + 1)

  for (let i = 0; i <= half; i++) {
    const src = i * scale
    const base = src | 0

    const j0 = base
    idx0[i] =
      j0 < half
        ? j0 < halfDiv2
          ? j0
          : half - 1 - (j0 - halfDiv2)
        : sizeMinus1 - (j0 - half)

    const j1 = base + 1
    if (j1 >= PSYMODEL_FFT_SIZE) {
      idx1[i] = idx0[i]
    } else {
      idx1[i] =
        j1 < half
          ? j1 < halfDiv2
            ? j1
            : half - 1 - (j1 - halfDiv2)
          : sizeMinus1 - (j1 - half)
    }

    w1[i] = src - base
  }

  return [idx0, idx1, w1]
})()

// FFT sizes for transient detection
export const FFT_SIZE_LOW = 256
export const FFT_SIZE_MID = 256
export const FFT_SIZE_HIGH = 512

// Quantization
export const QUANTIZATION_SIGN_BIT_SHIFT = 1

// WAV format
export const WAV_HEADER_SIZE = 44
export const WAV_BYTES_PER_SAMPLE = 2
export const WAV_BITS_PER_SAMPLE = 16
export const WAV_PCM_MAX_POSITIVE = 0x7fff
export const WAV_PCM_MAX_NEGATIVE = 0x8000
export const WAV_DATA_OFFSET = 36

// Frame serialization
export const FRAME_HEADER_BITS = 16
export const FRAME_WORD_LENGTH_BITS = 4
export const FRAME_SCALE_FACTOR_BITS = 6

// Tonal analysis flags
export const PSYMODEL_NOT_EXAMINED = 0
export const PSYMODEL_TONAL = 1
export const PSYMODEL_NON_TONAL = 2
export const PSYMODEL_IRRELEVANT = 3

// Pre-computed conversion factors
export const PSYMODEL_LOG10_FACTOR = 10 / Math.LN10
export const PSYMODEL_POW10_FACTOR = Math.LN10 / 10

// Critical band boundaries (0-24)
export const PSYMODEL_CRITICAL_BANDS = new Uint8Array([
  0, 1, 2, 4, 5, 7, 8, 10, 12, 14, 16, 19, 22, 26, 31, 36, 44, 49, 54, 60, 67,
  74, 80, 92, 105,
])

// Threshold table: [frequency_index, bark_value, threshold_value]
// prettier-ignore
export const PSYMODEL_THRESHOLD_TABLE = [
  [1.0, 0.85, 13.87], [2.0, 1.694, 2.85], [3.0, 2.525, -1.28], [4.0, 3.337, -3.5],
  [5.0, 4.124, -4.9], [6.0, 4.882, -5.89], [7.0, 5.608, -6.63], [8.0, 6.301, -7.21],
  [9.0, 6.959, -7.68], [10.0, 7.581, -8.08], [11.0, 8.169, -8.43], [12.0, 8.723, -8.75],
  [13.0, 9.244, -9.05], [14.0, 9.734, -9.33], [15.0, 10.195, -9.61], [16.0, 10.629, -9.89],
  [17.0, 11.037, -10.17], [18.0, 11.421, -10.47], [19.0, 11.783, -10.77], [20.0, 12.125, -11.1],
  [21.0, 12.448, -11.44], [22.0, 12.753, -11.79], [23.0, 13.042, -12.17], [24.0, 13.317, -12.56],
  [25.0, 13.577, -12.96], [26.0, 13.825, -13.38], [27.0, 14.062, -13.79], [28.0, 14.288, -14.21],
  [29.0, 14.504, -14.63], [30.0, 14.711, -15.03], [31.0, 14.909, -15.41], [32.0, 15.1, -15.77],
  [33.0, 15.283, -16.09], [34.0, 15.46, -16.37], [35.0, 15.631, -16.6], [36.0, 15.795, -16.78],
  [37.0, 15.955, -16.91], [38.0, 16.11, -16.97], [39.0, 16.26, -16.98], [40.0, 16.405, -16.92],
  [41.0, 16.547, -16.81], [42.0, 16.685, -16.65], [43.0, 16.82, -16.43], [44.0, 16.951, -16.17],
  [45.0, 17.079, -15.87], [46.0, 17.204, -15.54], [47.0, 17.327, -15.19], [48.0, 17.447, -14.82],
  [50.0, 17.68, -14.06], [52.0, 17.904, -13.32], [54.0, 18.121, -12.64], [56.0, 18.331, -12.04],
  [58.0, 18.534, -11.53], [60.0, 18.73, -11.11], [62.0, 18.922, -10.77], [64.0, 19.108, -10.49],
  [66.0, 19.288, -10.26], [68.0, 19.464, -10.07], [70.0, 19.635, -9.89], [72.0, 19.801, -9.72],
  [74.0, 19.963, -9.54], [76.0, 20.12, -9.37], [78.0, 20.273, -9.18], [80.0, 20.421, -8.97],
  [82.0, 20.565, -8.75], [84.0, 20.705, -8.51], [86.0, 20.84, -8.26], [88.0, 20.971, -7.98],
  [90.0, 21.099, -7.68], [92.0, 21.222, -7.36], [94.0, 21.341, -7.02], [96.0, 21.457, -6.65],
  [100.0, 21.676, -5.85], [104.0, 21.882, -4.93], [108.0, 22.074, -3.9], [112.0, 22.253, -2.75],
  [116.0, 22.42, -1.46], [120.0, 22.575, -0.03], [124.0, 22.721, 1.56], [128.0, 22.857, 3.31],
  [132.0, 22.984, 5.23], [136.0, 23.102, 7.34], [140.0, 23.213, 9.64], [144.0, 23.317, 12.15],
  [148.0, 23.414, 14.88], [152.0, 23.506, 17.84], [156.0, 23.592, 21.05], [160.0, 23.673, 24.52],
  [164.0, 23.749, 28.25], [168.0, 23.821, 32.27], [172.0, 23.888, 36.59], [176.0, 23.952, 41.22],
  [180.0, 24.013, 46.18], [184.0, 24.07, 51.49], [188.0, 24.124, 56.0], [192.0, 24.176, 56.0],
  [196.0, 24.225, 56.0], [200.0, 24.271, 56.0], [204.0, 24.316, 56.0], [208.0, 24.358, 56.0],
  [212.0, 24.398, 56.0], [216.0, 24.436, 56.0], [220.0, 24.473, 56.0], [224.0, 24.508, 56.0],
  [228.0, 24.541, 56.0], [232.0, 24.573, 56.0]
]
export const PSYMODEL_CB_FREQ_INDICES = PSYMODEL_CRITICAL_BANDS.map(
  (cbIdx) => PSYMODEL_THRESHOLD_TABLE[cbIdx][0] - 1
)

// Frequency to critical band mapping
export const PSYMODEL_FREQ_TO_CB_MAP = new Uint8Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
  22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
  41, 42, 43, 44, 45, 46, 47, 47, 48, 48, 49, 49, 50, 50, 51, 51, 52, 52, 53,
  53, 54, 54, 55, 55, 56, 56, 57, 57, 58, 58, 59, 59, 60, 60, 61, 61, 62, 62,
  63, 63, 64, 64, 65, 65, 66, 66, 67, 67, 68, 68, 69, 69, 70, 70, 71, 71, 71,
  71, 72, 72, 72, 72, 73, 73, 73, 73, 74, 74, 74, 74, 75, 75, 75, 75, 76, 76,
  76, 76, 77, 77, 77, 77, 78, 78, 78, 78, 79, 79, 79, 79, 80, 80, 80, 80, 81,
  81, 81, 81, 82, 82, 82, 82, 83, 83, 83, 83, 84, 84, 84, 84, 85, 85, 85, 85,
  86, 86, 86, 86, 87, 87, 87, 87, 88, 88, 88, 88, 89, 89, 89, 89, 90, 90, 90,
  90, 91, 91, 91, 91, 92, 92, 92, 92, 93, 93, 93, 93, 94, 94, 94, 94, 95, 95,
  95, 95, 96, 96, 96, 96, 97, 97, 97, 97, 98, 98, 98, 98, 99, 99, 99, 99, 100,
  100, 100, 100, 101, 101, 101, 101, 102, 102, 102, 102, 103, 103, 103, 103,
  104, 104, 104, 104, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105,
  105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105, 105,
  105,
])
