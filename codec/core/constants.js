/**
 * Carta1 scalar format constants.
 */

export const SAMPLE_RATE = 44100
export const SAMPLES_PER_FRAME = 512
export const FRAME_RATE = SAMPLE_RATE / SAMPLES_PER_FRAME

export const AEA_HEADER_SIZE = 2048
export const AEA_TITLE_OFFSET = 4
export const AEA_TITLE_SIZE = 256
export const AEA_FRAME_COUNT_OFFSET = 260
export const AEA_CHANNEL_COUNT_OFFSET = 264
export const AEA_PRIMING_SAMPLE_COUNT_OFFSET = 268
export const AEA_SOURCE_SAMPLE_COUNT_OFFSET = 272

export const STREAM_PRIMING_SAMPLES = 266
export const STREAM_FLUSH_TAIL_FRAMES = 1

export const SOUND_UNIT_SIZE = 212
export const FRAME_BITS = SOUND_UNIT_SIZE * 8
export const FRAME_OVERHEAD_BITS = 40
export const BITRATE_PER_CHANNEL = SOUND_UNIT_SIZE * FRAME_RATE * 8

export const NUM_BFUS = 52
export const MAX_BFU_SIZE = 20
export const BITS_PER_BFU_METADATA = 10
export const BFU_AMOUNTS_COUNT = 8

export const MDCT_SIZE_SHORT = 64
export const MDCT_SIZE_MID = 256
export const MDCT_SIZE_LONG = 512
export const MDCT_SHORT_BLOCK_SIZE = 32
export const MDCT_OVERLAP_SIZE = 32
export const MDCT_TAIL_WINDOW_SIZE = 16

export const QMF_BANDS = 2
export const QMF_TAPS = 48
export const QMF_ANALYSIS_START_SAMPLE = 0
export const QMF_ANALYSIS_STEP_SAMPLES = QMF_BANDS
export const QMF_ANALYSIS_WINDOW_SAMPLES = QMF_TAPS
export const QMF_ANALYSIS_MODULATION_SCALE = 1
export const QMF_ANALYSIS_TERMS = 24
export const QMF_ANALYSIS_DELAY_SAMPLES = QMF_TAPS - QMF_BANDS
export const QMF_SYNTHESIS_DELAY_ROWS = 24
export const QMF_SYNTHESIS_TERMS = 24
export const QMF_SYNTHESIS_DELAY_SAMPLES = QMF_BANDS * QMF_SYNTHESIS_DELAY_ROWS
export const QMF_HIGH_BAND_DELAY = 39

export const FFT_SIZE_LOW = 128
export const FFT_SIZE_MID = 128
export const FFT_SIZE_HIGH = 256

export const WAV_HEADER_SIZE = 44
export const WAV_BYTES_PER_SAMPLE = 2
export const WAV_BITS_PER_SAMPLE = 16
export const WAV_PCM_MAX_POSITIVE = 0x7fff
export const WAV_PCM_MAX_NEGATIVE = 0x8000
export const WAV_DATA_OFFSET = 36

export const FRAME_HEADER_BITS = 16
export const FRAME_WORD_LENGTH_BITS = 4
export const FRAME_SCALE_FACTOR_BITS = 6

export const QUANTIZATION_SIGN_BIT_SHIFT = 1
export const MAX_WORD_LENGTH_INDEX = 15
