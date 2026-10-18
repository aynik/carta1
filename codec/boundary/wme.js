/** Experimental ATRAC1 host extension; see README's WME contract.
 * API v1's current codec union does not include SPS/SPM. No PCM fallback.
 */
import { AeaFile } from './container.js'
import { AEA_HEADER_SIZE, SOUND_UNIT_SIZE } from '../core/constants.js'

const PROFILES = {
  SPS: { bitrate: 292, channels: 2 },
  SPM: { bitrate: 146, channels: 1 },
}

export default class CartaWmeEncoder {
  static customConstructionParameters = []

  constructor(api) {
    this.api = api
    this.ffmpeg = api.getBuiltinEncoder('ffmpeg')
    this.workerURL = null
    this.worker = null
    this.rejectJob = null
    this.busy = false
  }

  async init() {
    if (this.workerURL) return
    try {
      await this.ffmpeg.init()
      this.workerURL = URL.createObjectURL(
        new Blob([this.api.getOwnFile('worker.js')], {
          type: 'text/javascript',
        })
      )
    } catch (error) {
      await this.ffmpeg.deinit()
      throw error
    }
  }

  async deinit() {
    this.rejectJob?.(new Error('Encoder was stopped'))
    this.worker?.terminate()
    this.worker = null
    if (this.workerURL) URL.revokeObjectURL(this.workerURL)
    this.workerURL = null
    await this.ffmpeg.deinit()
  }

  getSupportFor(codec) {
    if (Object.hasOwn(PROFILES, codec)) {
      return {
        state: 'perfect',
        gapless: false,
        bitrates: [PROFILES[codec].bitrate],
      }
    }
    return { state: 'unsupported', gapless: false }
  }

  getUserFriendyStageName(stage) {
    if (stage === 'carta') return 'Encoding ATRAC1...'
    if (stage === 'ffmpeg') return 'Preparing audio...'
    return this.ffmpeg.getUserFriendyStageName(stage)
  }

  async transcode(source, sourceFileName, exportParams, progress) {
    if (!this.workerURL) throw new Error('Encoder is not initialized')
    if (this.busy) throw new Error('Encoder is already processing a track')
    const { codec, bitrate } = exportParams.format
    if (
      !Object.hasOwn(PROFILES, codec) ||
      bitrate !== PROFILES[codec].bitrate
    ) {
      throw new RangeError(
        'Unsupported carta1 recording format (experimental SPS/SPM host extension required)'
      )
    }
    this.busy = true
    try {
      return await this.encodeAtrac(
        source,
        sourceFileName,
        exportParams,
        progress
      )
    } finally {
      this.busy = false
    }
  }

  async encodeAtrac(source, sourceFileName, exportParams, progress) {
    const { channels } = PROFILES[exportParams.format.codec]
    const extension = sourceFileName.split('.').pop()
    const inputName = `carta1-input.${/^[a-z0-9]+$/i.test(extension) ? extension : 'audio'}`
    const outputName = 'carta1-pcm.f32'
    const process = this.ffmpeg.ffmpegProcess
    try {
      progress?.({ stage: 'ffmpeg', progress: 0, total: 1 })
      await process.write(inputName, source)
      // Preserve host resampling/ReplayGain, overriding its default stereo for SPM.
      const command = this.ffmpeg.createFfmpegParams(
        exportParams,
        'f32le',
        `-ac ${channels} -c:a pcm_f32le`
      )
      await process.transcode(inputName, outputName, command)
      const { data } = await process.read(outputName)
      const stride = channels * 4
      if (data.byteLength === 0 || data.byteLength % stride !== 0) {
        throw new RangeError('Expected nonempty channel-aligned float32 PCM')
      }
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      const samples = data.byteLength / stride
      const pcmData = Array.from(
        { length: channels },
        () => new Float32Array(samples)
      )
      for (let sample = 0; sample < samples; sample++) {
        for (let channel = 0; channel < channels; channel++) {
          pcmData[channel][sample] = view.getFloat32(
            sample * stride + channel * 4,
            true
          )
        }
      }
      progress?.({ stage: 'ffmpeg', progress: 1, total: 1 })
      progress?.({ stage: 'carta', progress: 0, total: 1 })
      const aea = await this.encodeInWorker(pcmData)
      if (aea.byteLength <= AEA_HEADER_SIZE) {
        throw new Error('Worker returned an incompatible ATRAC1 AEA file')
      }
      const info = AeaFile.parseHeader(aea.subarray(0, AEA_HEADER_SIZE))
      const payloadLength = aea.byteLength - AEA_HEADER_SIZE
      if (
        info.channelCount !== channels ||
        payloadLength % (SOUND_UNIT_SIZE * channels) !== 0 ||
        info.frameCount * SOUND_UNIT_SIZE !== payloadLength
      ) {
        throw new Error('Worker returned an incompatible ATRAC1 AEA file')
      }
      progress?.({ stage: 'carta', progress: 1, total: 1 })
      // Proposed host contract: raw 212-byte sound units, no AEA header.
      // Stereo units alternate L/R. Keep canonical priming and drain units.
      return aea.slice(AEA_HEADER_SIZE)
    } finally {
      // FFmpeg 0.6 tracks pending FS jobs by action, not job ID. Parallel
      // removals overwrite the resolver and leave one promise pending forever.
      for (const filename of [inputName, outputName]) {
        try {
          await process.remove(filename)
        } catch {
          // A failed conversion may not have created both temporary files.
        }
      }
    }
  }

  async encodeInWorker(pcmData) {
    const worker = new Worker(this.workerURL)
    this.worker = worker
    try {
      const result = await new Promise((resolve, reject) => {
        this.rejectJob = reject
        worker.onmessage = ({ data }) => {
          if (data.jobId !== 1) return
          if (data.error) reject(new Error(data.error))
          else resolve(data.result)
        }
        worker.onerror = (event) =>
          reject(new Error(event.message || 'Codec worker failed'))
        worker.onmessageerror = () =>
          reject(new Error('Invalid codec worker response'))
        worker.postMessage(
          {
            jobId: 1,
            type: 'encode',
            pcmData,
            options: {},
          },
          pcmData.map((channel) => channel.buffer)
        )
      })
      return new Uint8Array(await result.aeaBlob.arrayBuffer())
    } finally {
      this.rejectJob = null
      worker.terminate()
      this.worker = null
    }
  }
}
