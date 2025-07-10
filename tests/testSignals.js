// test/testSignals.js
export const TEST_SIGNALS = {
  silence: (length = 512) => new Float32Array(length),
  dc: (value = 1.0, length = 512) => new Float32Array(length).fill(value),
  sine: (freq, sampleRate = 44100, length = 512) => {
    const arr = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      arr[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate)
    }
    return arr
  },
  impulse: (position = 0, length = 512) => {
    const arr = new Float32Array(length)
    arr[position] = 1.0
    return arr
  },
  whiteNoise: (seed = 1, length = 512) => {
    const arr = new Float32Array(length)
    let x = seed
    for (let i = 0; i < length; i++) {
      x = Math.sin(x) * 10000
      arr[i] = x - Math.floor(x)
    }
    return arr
  },
  chirp: (startFreq, endFreq, length = 512, sampleRate = 44100) => {
    const arr = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate
      const phase =
        2 *
        Math.PI *
        (startFreq * t +
          ((endFreq - startFreq) * t * t) / ((2 * length) / sampleRate))
      arr[i] = Math.sin(phase)
    }
    return arr
  },
  step: (position = 256, length = 512) => {
    const arr = new Float32Array(length)
    for (let i = position; i < length; i++) {
      arr[i] = 1.0
    }
    return arr
  },
}
