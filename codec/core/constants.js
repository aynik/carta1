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
  const table = new Float64Array(32)
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

// FFT sizes for transient detection
export const FFT_SIZE_LOW = 128
export const FFT_SIZE_MID = 128
export const FFT_SIZE_HIGH = 256

// MDCT/IMDCT transform configuration
export const MDCT_BAND_CONFIGS = [
  { size: 128, windowStart: 48 }, // Low band (0-5.5kHz)
  { size: 128, windowStart: 48 }, // Mid band (5.5-11kHz)
  { size: 256, windowStart: 112 }, // High band (11-22kHz)
]

export const MDCT_SHORT_BLOCK_SIZE = 32
export const MDCT_OVERLAP_SIZE = 32
export const MDCT_TAIL_WINDOW_SIZE = 16

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

// Quantization
export const QUANTIZATION_SIGN_BIT_SHIFT = 1
export const MAX_WORD_LENGTH_INDEX = 15
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

// Bit allocation
export const INV_POWER_OF_TWO = (() => {
  const maxBits = WORD_LENGTH_BITS[MAX_WORD_LENGTH_INDEX]
  const table = new Float64Array(maxBits + 1)
  for (let b = 0; b <= maxBits; b++) {
    table[b] = Math.pow(2, -b)
  }
  return table
})()
