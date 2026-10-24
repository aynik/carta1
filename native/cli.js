import { argumentsList, exitFailure, readFile, writeFile } from './host.js'
import { AudioProcessor, decodeAeaPcm, encodeAeaPcm } from '../codec/index.js'
import { validateAeaTitle } from '../codec/boundary/container.js'
import { parsePcmWave } from '../codec/boundary/pcm.js'
import { inspectAea } from '../codec/boundary/inspect.js'
import { validateModes } from '../bin/options.js'
import { version } from './version.js'
import { stringifyInspection } from './json.js'

const HELP = `Usage: carta1 [options] <input> <output>

ATRAC1 Audio Codec (native)

  -e, --encode         Encode integer PCM WAV to AEA
  -d, --decode         Decode AEA to PCM16 WAV
  -j, --json           Dump AEA structure to JSON
  -q, --quiet          Suppress output except errors
  -f, --force          Overwrite output
  -t, --title <title>  UTF-8 AEA title (up to 255 bytes)
  -b, --bias <value>   Bit allocation bias (default: 1.0)
  -m, --modes <modes>  Fixed block modes: [0/2],[0/2],[0/3]
  -V, --version        Print version
  -h, --help           Print help

Input: mono/stereo signed 16/24/32-bit PCM WAV, normally 44100 Hz.
The native adapter processes complete files in memory.`

function parseArguments(args) {
  const options = { files: [] }
  const flags = {
    e: 'encode',
    d: 'decode',
    j: 'json',
    q: 'quiet',
    f: 'force',
    h: 'help',
    V: 'version',
  }
  const values = { t: 'title', b: 'bias', m: 'modes' }
  let positional = false
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (positional || argument[0] !== '-' || argument === '-') {
      options.files.push(argument)
      continue
    }
    if (argument === '--') {
      positional = true
      continue
    }
    if (argument.startsWith('--')) {
      const separator = argument.indexOf('=')
      const name = argument.slice(2, separator < 0 ? undefined : separator)
      if (Object.values(flags).includes(name) && separator < 0)
        options[name] = true
      else if (Object.values(values).includes(name)) {
        const value =
          separator < 0 ? args[++index] : argument.slice(separator + 1)
        if (value === undefined) throw new Error(`Missing value for --${name}`)
        options[name] = value
      } else throw new Error(`Unknown option: ${argument}`)
    } else {
      for (let offset = 1; offset < argument.length; offset++) {
        const key = argument[offset]
        if (flags[key]) options[flags[key]] = true
        else if (values[key]) {
          const value =
            offset + 1 < argument.length
              ? argument.slice(offset + 1)
              : args[++index]
          if (value === undefined) throw new Error(`Missing value for -${key}`)
          options[values[key]] = value
          break
        } else throw new Error(`Unknown option: -${key}`)
      }
    }
  }
  return options
}

async function main() {
  const options = parseArguments(argumentsList())
  if (options.help) {
    console.log(HELP)
    return
  }
  if (options.version) {
    console.log(version)
    return
  }
  if (
    [options.encode, options.decode, options.json].filter(Boolean).length !== 1
  ) {
    throw new Error('Must specify exactly one of --encode, --decode, or --json')
  }
  if (options.files.length !== 2)
    throw new Error('Expected input and output file paths')
  const [inputFile, outputFile] = options.files
  let result
  if (options.encode) {
    const wave = parsePcmWave(readFile(inputFile))
    if (wave.sampleRate !== 44100 && !options.quiet)
      console.log(
        `Warning: Input sample rate ${wave.sampleRate}Hz, expected 44100Hz`
      )
    const title =
      options.title ||
      outputFile.slice(outputFile.lastIndexOf('/') + 1).replace(/\.aea$/, '')
    const validation = validateAeaTitle(title)
    if (!validation.valid) throw new Error(validation.error)
    const modes = validateModes(options.modes)
    if (!modes.valid) throw new Error(modes.error)
    const settings = { title }
    if (modes.modes) settings.fixedBlockModes = modes.modes
    if (options.bias !== undefined) {
      const bias = Number(options.bias)
      if (!Number.isFinite(bias))
        throw new Error('Bias must be a finite number')
      settings.allocationBias = bias
    }
    result = await encodeAeaPcm(wave.channels, settings)
  } else if (options.decode) {
    const channels = await decodeAeaPcm(readFile(inputFile))
    const frames =
      channels.length === 1 ? [channels[0]] : [[channels[0], channels[1]]]
    result = new Uint8Array(
      await AudioProcessor.createPcmWaveBlob(
        frames,
        channels.length
      ).arrayBuffer()
    )
  } else {
    result = new TextEncoder().encode(
      stringifyInspection(inspectAea(readFile(inputFile), inputFile))
    )
  }
  writeFile(outputFile, result, options.force)
  if (!options.quiet) console.log(`${inputFile} → ${outputFile}`)
}

main().catch((error) => {
  console.error(`Error: ${error.message}`)
  exitFailure()
})
