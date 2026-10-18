import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CartaWmeEncoder from '../codec/boundary/wme.js'
import { encodeAeaPcm, AeaFile } from '../codec/index.js'
import { createWmeArchive } from '../bin/build-wme.js'

const FORMATS = [
  { codec: 'SPS', bitrate: 292 },
  { codec: 'SPM', bitrate: 146 },
]
const FORMAT = FORMATS[0]
const PARAMS = { format: FORMAT, enableReplayGain: true, writeGapless: false }

function pcmBytes(channels = 2) {
  // Include a nonzero offset to exercise FFmpeg byte views correctly.
  const storage = new Uint8Array(8 + 19 * channels * 4)
  const data = storage.subarray(8)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let sample = 0; sample < 19; sample++) {
    view.setFloat32(sample * channels * 4, Math.sin(sample) * 0.25, true)
    if (channels === 2)
      view.setFloat32(sample * 8 + 4, Math.cos(sample) * 0.125, true)
  }
  return data
}

let ffmpeg, api, encoder, workers, workerFailure

beforeEach(() => {
  workers = []
  workerFailure = null
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        this.terminate = vi.fn()
        workers.push(this)
      }
      postMessage(message) {
        this.message = message
        queueMicrotask(async () => {
          if (workerFailure === 'crash') {
            this.onerror({ message: 'worker crashed' })
          } else if (workerFailure === 'message') {
            this.onmessage({ data: { jobId: 1, error: 'encoding failed' } })
          } else if (workerFailure !== 'pending') {
            const wave = await encodeAeaPcm(message.pcmData, message.options)
            this.onmessage({
              data: { jobId: 1, result: { aeaBlob: new Blob([wave]) } },
            })
          }
        })
      }
    }
  )
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:codec-worker')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  ffmpeg = {
    init: vi.fn(),
    deinit: vi.fn(),
    transcode: vi.fn().mockResolvedValue(new Uint8Array([42])),
    createFfmpegParams: vi
      .fn()
      .mockReturnValue('-ac 2 -ar 44100 -c:a pcm_f32le -f f32le'),
    getSupportFor: vi.fn().mockReturnValue({ state: 'perfect', gapless: true }),
    getUserFriendyStageName: vi.fn().mockReturnValue(null),
    ffmpegProcess: {
      write: vi.fn(),
      transcode: vi.fn(),
      read: vi.fn().mockResolvedValue({ data: pcmBytes() }),
      remove: vi.fn(),
    },
  }
  api = {
    getBuiltinEncoder: vi.fn().mockReturnValue(ffmpeg),
    getOwnFile: vi.fn().mockReturnValue(new Uint8Array([1])),
  }
  encoder = new CartaWmeEncoder(api)
})

afterEach(async () => {
  await encoder.deinit()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('experimental ATRAC1 WME extension', () => {
  it('advertises the proposed SP extension and rejects every current API v1 codec', () => {
    expect(CartaWmeEncoder.customConstructionParameters).toEqual([])
    for (const { codec, bitrate } of FORMATS) {
      expect(encoder.getSupportFor(codec)).toEqual({
        state: 'perfect',
        gapless: false,
        bitrates: [bitrate],
      })
    }
    for (const codec of ['AT3', 'A3+', 'PCM', 'MP3', 'unknown', 'toString']) {
      expect(encoder.getSupportFor(codec).state).toBe('unsupported')
    }
    expect(ffmpeg.getSupportFor).not.toHaveBeenCalled()
  })

  it.each(FORMATS)(
    'returns canonical raw ATRAC1 for $codec',
    async (format) => {
      const channels = format.codec === 'SPS' ? 2 : 1
      ffmpeg.ffmpegProcess.read.mockResolvedValue({ data: pcmBytes(channels) })
      await encoder.init()
      const params = { ...PARAMS, format }
      const progress = vi.fn()
      const result = await encoder.transcode(
        new Uint8Array([1]),
        'song.flac',
        params,
        progress
      )
      const { pcmData, options } = workers[0].message
      expect(pcmData).toHaveLength(channels)
      expect(pcmData[0][1]).toBeCloseTo(Math.sin(1) * 0.25)
      if (channels === 2) expect(pcmData[1][1]).toBeCloseTo(Math.cos(1) * 0.125)
      const expectedAea = await encodeAeaPcm(pcmData, options)
      expect(result).toEqual(expectedAea.slice(2048))
      expect(result.length % (212 * channels)).toBe(0)
      expect(ffmpeg.createFfmpegParams).toHaveBeenCalledWith(
        params,
        'f32le',
        `-ac ${channels} -c:a pcm_f32le`
      )
      expect(progress).toHaveBeenLastCalledWith({
        stage: 'carta',
        progress: 1,
        total: 1,
      })
      expect(workers[0].terminate).toHaveBeenCalled()
      expect(ffmpeg.ffmpegProcess.remove).toHaveBeenCalledTimes(2)
    }
  )

  it('rejects unsupported formats before touching FFmpeg', async () => {
    await encoder.init()
    for (const format of [
      { codec: 'A3+', bitrate: 132 },
      { codec: 'SPS', bitrate: 999 },
      { codec: 'SPM', bitrate: 292 },
      { codec: 'PCM', bitrate: 1411 },
      { codec: 'toString', bitrate: 146 },
    ]) {
      await expect(
        encoder.transcode(new Uint8Array(), 'a.wav', { format })
      ).rejects.toThrow('Unsupported')
    }
    expect(ffmpeg.ffmpegProcess.write).not.toHaveBeenCalled()
  })

  it('requires init and releases URLs and FFmpeg on deinit', async () => {
    await expect(
      encoder.transcode(new Uint8Array(), 'a.wav', PARAMS)
    ).rejects.toThrow('not initialized')
    await encoder.init()
    await encoder.init()
    expect(ffmpeg.init).toHaveBeenCalledTimes(1)
    await encoder.deinit()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:codec-worker')
    expect(ffmpeg.deinit).toHaveBeenCalled()
  })

  it.each(['crash', 'message'])(
    'cleans up after a worker %s and allows another track',
    async (failure) => {
      await encoder.init()
      workerFailure = failure
      await expect(
        encoder.transcode(new Uint8Array(), 'a.wav', PARAMS)
      ).rejects.toThrow()
      expect(workers[0].terminate).toHaveBeenCalled()
      expect(ffmpeg.ffmpegProcess.remove).toHaveBeenCalledTimes(2)
      workerFailure = null
      await expect(
        encoder.transcode(new Uint8Array(), 'a.wav', PARAMS)
      ).resolves.toBeInstanceOf(Uint8Array)
    }
  )

  it('rejects simultaneous jobs and stops an active worker on deinit', async () => {
    await encoder.init()
    workerFailure = 'pending'
    const result = encoder.transcode(new Uint8Array(), 'a.wav', PARAMS)
    const rejected = expect(result).rejects.toThrow('stopped')
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    await expect(
      encoder.transcode(new Uint8Array(), 'b.wav', PARAMS)
    ).rejects.toThrow('already processing')
    await encoder.deinit()
    await rejected
    expect(workers[0].terminate).toHaveBeenCalled()
  })

  it.each([new Uint8Array(0), new Uint8Array(7)])(
    'rejects malformed intermediate PCM',
    async (data) => {
      await encoder.init()
      ffmpeg.ffmpegProcess.read.mockResolvedValue({ data })
      await expect(
        encoder.transcode(new Uint8Array(), 'a.wav', PARAMS)
      ).rejects.toThrow('float32 PCM')
      expect(workers).toHaveLength(0)
      expect(ffmpeg.ffmpegProcess.remove).toHaveBeenCalledTimes(2)
    }
  )

  it('cleans temporary files on FFmpeg failure and rejects incompatible output', async () => {
    await encoder.init()
    ffmpeg.ffmpegProcess.transcode.mockRejectedValueOnce(
      new Error('decode failed')
    )
    await expect(
      encoder.transcode(new Uint8Array(), 'a.wav', PARAMS)
    ).rejects.toThrow('decode failed')
    expect(ffmpeg.ffmpegProcess.remove).toHaveBeenCalledTimes(2)
    vi.spyOn(AeaFile, 'parseHeader').mockReturnValue({
      channelCount: 1,
      frameCount: 2,
    })
    await expect(
      encoder.transcode(new Uint8Array(), 'a.wav', PARAMS)
    ).rejects.toThrow('incompatible')
  })

  it('serializes cleanup for the host FFmpeg single-flight filesystem API', async () => {
    let pending = 0
    let maximumPending = 0
    ffmpeg.ffmpegProcess.remove.mockImplementation(async () => {
      pending++
      maximumPending = Math.max(maximumPending, pending)
      await new Promise((resolve) => setTimeout(resolve, 0))
      pending--
    })
    await encoder.init()
    await encoder.transcode(new Uint8Array(), 'a.wav', PARAMS)
    expect(maximumPending).toBe(1)
    expect(ffmpeg.ffmpegProcess.remove).toHaveBeenCalledTimes(2)
  })

  it('attempts both removals when an earlier conversion did not create a file', async () => {
    await encoder.init()
    ffmpeg.ffmpegProcess.transcode.mockRejectedValueOnce(
      new Error('decode failed')
    )
    ffmpeg.ffmpegProcess.remove.mockRejectedValueOnce(new Error('missing file'))
    await expect(
      encoder.transcode(new Uint8Array(), 'a.wav', PARAMS)
    ).rejects.toThrow('decode failed')
    expect(ffmpeg.ffmpegProcess.remove).toHaveBeenCalledTimes(2)
  })

  it('rolls back a failed init', async () => {
    api.getOwnFile.mockImplementation(() => {
      throw new Error('missing worker')
    })
    await expect(encoder.init()).rejects.toThrow('missing worker')
    expect(ffmpeg.deinit).toHaveBeenCalled()
  })
})

it('writes metadata first in the upstream big-endian SAR wire format', () => {
  const metadata = { encoderId: 'carta1', apiVersion: '1' }
  const archive = createWmeArchive(
    metadata,
    'export default class {}',
    'worker'
  )
  expect(archive.subarray(0, 7).toString()).toBe('SARFile')
  const subMagicLength = archive.readUInt16BE(7)
  expect(archive.subarray(9, 9 + subMagicLength).toString()).toBe(
    'Web MiniDisc Dynamic Encoder'
  )
  const entries = new Map()
  let offset = 9 + subMagicLength
  while (offset < archive.length) {
    const length = archive.readUInt16BE(offset)
    const name = archive.subarray(offset + 2, offset + 2 + length).toString()
    offset += 2 + length
    const size = archive.readUInt32BE(offset)
    offset += 4
    entries.set(name, archive.subarray(offset, offset + size).toString())
    offset += size
  }
  expect([...entries.keys()]).toEqual([
    'metadata.json',
    'index.js',
    'worker.js',
  ])
  expect(JSON.parse(entries.get('metadata.json'))).toEqual(metadata)
  expect(entries.get('index.js')).toBe('export default class {}')
  expect(entries.get('worker.js')).toBe('worker')
  expect(archive).toEqual(
    createWmeArchive(metadata, 'export default class {}', 'worker')
  )
})
