import { describe, it, expect } from 'vitest'
import {
  throwError,
  pipe,
  withFlushSamples,
  withDelayCompensation,
  withStereo,
} from '../codec/utils'
import { SAMPLES_PER_FRAME } from '../codec/core/constants'

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

  describe('withFlushSamples', async () => {
    async function* createFrameStream(lengths) {
      for (const length of lengths) {
        yield new Float64Array(length)
      }
    }

    it('should pad incomplete frames', async () => {
      const stream = createFrameStream([SAMPLES_PER_FRAME, 200])
      const flushedStream = withFlushSamples(stream)
      const result = []
      for await (const frame of flushedStream) {
        result.push(frame)
      }
      expect(result.length).toBe(2)
      expect(result[0].length).toBe(SAMPLES_PER_FRAME)
      expect(result[1].length).toBe(SAMPLES_PER_FRAME)
    })

    it('should add a flush frame when needed', async () => {
      const stream = createFrameStream([
        SAMPLES_PER_FRAME,
        SAMPLES_PER_FRAME - 100,
      ])
      const flushedStream = withFlushSamples(stream, 200)
      const result = []
      for await (const frame of flushedStream) {
        result.push(frame)
      }
      expect(result.length).toBe(3)
      expect(result[2].length).toBe(SAMPLES_PER_FRAME)
    })
  })

  describe('withDelayCompensation', async () => {
    async function* createFrameStream(lengths, value = 1) {
      for (const length of lengths) {
        yield new Float64Array(length).fill(value)
      }
    }

    it('should drop initial samples', async () => {
      const stream = createFrameStream([SAMPLES_PER_FRAME])
      const compensatedStream = withDelayCompensation(stream, 100)
      const result = []
      for await (const frame of compensatedStream) {
        result.push(frame)
      }
      expect(result.length).toBe(1)
      expect(result[0].length).toBe(SAMPLES_PER_FRAME - 100)
    })

    it('should handle multi-frame drops', async () => {
      const stream = createFrameStream([
        SAMPLES_PER_FRAME,
        SAMPLES_PER_FRAME,
        SAMPLES_PER_FRAME,
      ])
      const compensatedStream = withDelayCompensation(
        stream,
        266 // CODEC_DELAY for mono
      )
      const result = []
      for await (const frame of compensatedStream) {
        result.push(frame)
      }

      expect(result.length).toBe(3)
      expect(result[0].length).toBe(SAMPLES_PER_FRAME)
      expect(result[1].length).toBe(SAMPLES_PER_FRAME)
      expect(result[2].length).toBe(246) // 512 - 266
    })
  })

  describe('withStereo', async () => {
    async function* createStereoStream(count) {
      for (let i = 0; i < count; i++) {
        yield [
          new Float64Array(SAMPLES_PER_FRAME).fill(i),
          new Float64Array(SAMPLES_PER_FRAME).fill(i + 100),
        ]
      }
    }

    async function* monoTransform(iter) {
      for await (const frame of iter) {
        const newFrame = new Float64Array(frame.length)
        for (let i = 0; i < frame.length; i++) {
          newFrame[i] = frame[i] * 2
        }
        yield newFrame
      }
    }

    it('should process channels independently', async () => {
      const stream = createStereoStream(2)
      const stereoTransform = withStereo(monoTransform)
      const result = []
      for await (const frame of stereoTransform(stream)) {
        result.push(frame)
      }

      expect(result.length).toBe(2)
      // Check left channel
      expect(result[0][0][0]).toBe(0)
      expect(result[1][0][0]).toBe(2)

      // Check right channel
      expect(result[0][1][0]).toBe(200)
      expect(result[1][1][0]).toBe(202)
    })
  })
})
