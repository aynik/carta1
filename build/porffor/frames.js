// Internal frame-only probe: deliberately excludes the unsupported host APIs.
import { encode } from '../../codec/pipeline/encoder.js'
import { decode } from '../../codec/pipeline/decoder.js'
import { EncoderOptions } from '../../codec/core/options.js'
import { serializeFrame, deserializeFrame } from '../../codec/syntax/frame.js'

const profiles = [
  {},
  { fixedBlockModes: [0, 0, 0] },
  { fixedBlockModes: [2, 2, 3], allocationBias: 1.25 },
]

for (let profile = 0; profile < profiles.length; profile++) {
  for (let signal = 0; signal < 4; signal++) {
    for (let channels = 1; channels <= 2; channels++) {
      // Independent state per channel, reused across chronological frames.
      const encoders = []
      const decoders = []
      for (let channel = 0; channel < channels; channel++) {
        encoders.push(encode(new EncoderOptions(profiles[profile])))
        decoders.push(decode())
      }
      let seed = 123456789
      for (let frame = 0; frame < 8; frame++) {
        for (let channel = 0; channel < channels; channel++) {
          const input = new Float32Array(512)
          for (let sample = 0; sample < input.length; sample++) {
            const position = frame * 512 + sample
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
            // Silence, impulses, a sawtooth, and reproducible noise. Integer
            // sources avoid confusing input libm differences with codec drift.
            if (frame < 6) {
              if (signal === 1 && position % (389 + channel * 74) === 0) {
                input[sample] = channel === 0 ? 0.75 : -0.5
              }
              if (signal === 2) {
                input[sample] =
                  (((position * (73 + channel * 30)) % 65536) - 32768) / 65536
              }
              if (signal === 3) input[sample] = (seed / 4294967296 - 0.5) * 1.5
            }
          }
          const bytes = serializeFrame(encoders[channel](input))
          const pcm = decoders[channel](deserializeFrame(bytes))
          // Compare float32 bit patterns, including signed zero, rather than
          // rounded decimal samples or a perceptual tolerance.
          const bits = new Uint32Array(pcm.buffer, pcm.byteOffset, pcm.length)
          console.log(
            JSON.stringify({
              profile,
              signal,
              channels,
              frame,
              channel,
              input: Array.from(new Uint32Array(input.buffer)),
              bytes: Array.from(bytes),
              pcm: Array.from(bits),
            })
          )
        }
      }
    }
  }
}
