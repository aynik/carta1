/**
 * Carta1 Worker Interface - Client-side API
 *
 * Provides a clean async interface for encoding and decoding ATRAC1 audio
 * using Web Workers for non-blocking operation.
 *
 * Usage:
 *   const codec = new Carta1Worker('carta1-worker.min.js')
 *   const result = await codec.encode(pcmData, options)
 *   codec.terminate()
 *
 * The worker path can be customized to match your deployment:
 *   new Carta1Worker('/js/carta1-worker.min.js')
 *   new Carta1Worker('https://cdn.example.com/carta1-worker.min.js')
 */

class Carta1Worker {
  /**
   * Create a new ATRAC1 codec worker
   *
   * @param {string} [workerPath='atrac1-worker.min.js'] - Path to the worker script
   */
  constructor(workerPath = 'carta1-worker.min.js') {
    this.worker = new Worker(workerPath)
    this.nextJobId = 1
    this.jobs = new Map()

    // Handle worker responses
    this.worker.onmessage = (e) => {
      const { jobId, error, result } = e.data

      if (!jobId) {
        console.warn('Received message without jobId:', e.data)
        return
      }

      if (this.jobs.has(jobId)) {
        const { resolve, reject } = this.jobs.get(jobId)
        this.jobs.delete(jobId)

        if (error) {
          reject(new Error(error))
        } else if (result) {
          resolve(result)
        } else {
          reject(new Error('Worker returned no result'))
        }
      } else {
        console.warn('Received result for unknown job:', jobId)
      }
    }

    // Handle worker errors
    this.worker.onerror = (error) => {
      console.error('Worker crashed:', error)
      // Reject all pending jobs
      for (const [, { reject }] of this.jobs) {
        reject(new Error('Worker crashed: ' + error.message))
      }
      this.jobs.clear()
    }
  }

  /**
   * Encode PCM audio to ATRAC1 format
   *
   * @param {Float64Array|Array<Float64Array>} pcmData - PCM audio data
   *   - Mono: Float64Array
   *   - Stereo: [left, right] Float64Arrays
   * @param {Object} [options={}] - Encoder options
   * @param {number} [options.transientThresholdLow] - Low band transient threshold
   * @param {number} [options.transientThresholdMid] - Mid band transient threshold
   * @param {number} [options.transientThresholdHigh] - High band transient threshold
   * @returns {Promise<Object>} Encoding result
   * @returns {Blob} returns.aeaBlob - ATRAC1 encoded audio blob
   * @returns {Object} returns.shortBlockData - Short block frame indices
   */
  async encode(pcmData, options = {}) {
    const jobId = this.nextJobId++
    return new Promise((resolve, reject) => {
      this.jobs.set(jobId, { resolve, reject })
      try {
        // Ensure plain object for serialization
        const plainOptions = { ...options }
        this.worker.postMessage({
          jobId,
          type: 'encode',
          pcmData,
          options: plainOptions,
        })
      } catch (error) {
        this.jobs.delete(jobId)
        reject(error)
      }
    })
  }

  /**
   * Decode ATRAC1 audio to PCM WAV format
   *
   * @param {Object} aea - ATRAC1 audio data
   * @param {Uint8Array} aea.header - AEA file header
   * @param {Array} aea.aeaData - Encoded frame data
   * @param {Object} [aea.info] - Optional metadata
   * @returns {Promise<Object>} Decoding result
   * @returns {Blob} returns.wavBlob - Decoded WAV audio blob
   * @returns {Object} returns.info - Audio metadata (channels, sample rate)
   */
  async decode(aea) {
    const jobId = this.nextJobId++
    return new Promise((resolve, reject) => {
      this.jobs.set(jobId, { resolve, reject })
      try {
        this.worker.postMessage({ jobId, type: 'decode', aea })
      } catch (error) {
        this.jobs.delete(jobId)
        reject(error)
      }
    })
  }

  /**
   * Parse AEA file blob to extract metadata and frame data
   *
   * @param {Blob} blob - AEA file blob
   * @returns {Promise<Object>} Parsed AEA data
   * @returns {Uint8Array} returns.header - AEA file header
   * @returns {Array} returns.aeaData - Encoded frame data
   * @returns {Object} returns.info - Metadata (title, channels, frames)
   */
  async parseAeaBlob(blob) {
    const jobId = this.nextJobId++
    return new Promise((resolve, reject) => {
      this.jobs.set(jobId, { resolve, reject })
      try {
        this.worker.postMessage({ jobId, type: 'parseAea', blob })
      } catch (error) {
        this.jobs.delete(jobId)
        reject(error)
      }
    })
  }

  /**
   * Get default encoder options metadata
   *
   * @returns {Promise<Object>} Default encoder options
   */
  async getEncoderOptions() {
    const jobId = this.nextJobId++
    return new Promise((resolve, reject) => {
      this.jobs.set(jobId, { resolve, reject })
      try {
        this.worker.postMessage({ jobId, type: 'getEncoderOptions' })
      } catch (error) {
        this.jobs.delete(jobId)
        reject(error)
      }
    })
  }

  /**
   * Terminate the worker and clean up resources
   *
   * Call this when done using the codec to free memory
   */
  terminate() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.jobs.clear()
  }
}

export default Carta1Worker
export { Carta1Worker }
