# Carta1

Carta1 is an ATRAC1 encoder and decoder in JavaScript. It converts PCM WAVE
audio to Sony's AEA container, decodes AEA back to PCM WAVE, exposes stateful
frame and stream APIs, and ships browser Web Worker bundles.

## Supported format

| Property           | Support                                       |
| ------------------ | --------------------------------------------- |
| Sample rate        | 44.1 kHz                                      |
| Channels           | Mono or stereo                                |
| Frame size         | 512 PCM samples per channel                   |
| Encoded sound unit | 212 bytes per channel                         |
| Nominal bitrate    | About 146 kbps per channel / 292 kbps stereo  |
| Container          | AEA                                           |
| JavaScript PCM     | Planar `Float32Array`, normalized `-1` to `1` |

Stereo channels are encoded independently and stored as interleaved AEA sound
units.

## Installation

Carta1 is an ES module and requires Node.js 20.16 or newer.

```bash
npm install carta1
```

To work from a repository checkout:

```bash
npm ci
npm run check
```

## CLI

Run the installed executable directly, or use `npx carta1` from a project that
depends on Carta1:

```bash
carta1 --encode input.wav output.aea
carta1 --decode input.aea output.wav
carta1 --json input.aea structure.json

npx carta1 --encode input.wav output.aea
```

The encoder accepts mono or stereo PCM WAVE input. Carta1 is designed for
44.1 kHz audio; it warns when the input sample rate differs. Decoding writes
signed 16-bit PCM WAVE output.

| Option                | Meaning                                              |
| --------------------- | ---------------------------------------------------- |
| `-e, --encode`        | Encode PCM WAVE to AEA.                              |
| `-d, --decode`        | Decode AEA to PCM WAVE.                              |
| `-j, --json`          | Write AEA metadata and frame structure as JSON.      |
| `-q, --quiet`         | Suppress normal output and progress.                 |
| `-f, --force`         | Overwrite an existing output file.                   |
| `-t, --title <title>` | Set the AEA title while encoding.                    |
| `-b, --bias <value>`  | Set the bit-allocation bias; defaults to `1.0`.      |
| `-m, --modes <modes>` | Fix low, mid, and high block modes, such as `0,0,0`. |
| `-V, --version`       | Print the Carta1 version.                            |
| `-h, --help`          | Print command help.                                  |

Exactly one of `--encode`, `--decode`, and `--json` is required. The input and
output are positional paths. Existing output is preserved unless `--force` is
provided.

## JavaScript API

### Complete AEA files

Use `encodeAeaPcm()` and `decodeAeaPcm()` when the complete input fits in
memory:

```js
import { decodeAeaPcm, encodeAeaPcm } from 'carta1'

const aea = await encodeAeaPcm([left, right], {
  allocationBias: 1.0,
  title: 'Example',
})
const [decodedLeft, decodedRight] = await decodeAeaPcm(aea)
```

`encodeAeaPcm()` returns a `Uint8Array` containing a complete AEA file.
`decodeAeaPcm()` accepts AEA bytes or a `Blob` and returns normalized planar
`Float32Array` channels. A mono input uses `[mono]`. The final partial input
frame is zero-padded.

### Stateful frames

`encode()` and `decode()` create closures for chronological, complete mono
frames. Reuse each closure for one stream:

```js
import { decode, encode, EncoderOptions } from 'carta1'

const encodeFrame = encode(new EncoderOptions({ transientThresholdLow: 1.0 }))
const decodeFrame = decode()

const encoded = encodeFrame(new Float32Array(512))
const decoded = decodeFrame(encoded)
```

Use separate closures for separate streams and for the left and right channels
of stereo audio. `AudioProcessor.encodeStream()` and `decodeStream()` handle
that ownership automatically.

### Encoder options

`EncoderOptions` validates these settings:

- `transientThresholdLow`, `transientThresholdMid`, and
  `transientThresholdHigh` tune short-block detection per frequency band.
- `allocationBias` changes how strongly allocation favors louder spectral
  components.
- `fixedBlockModes` accepts `[low, mid, high]`, where low and mid are `0` or
  `2`, and high is `0` or `3`; this bypasses transient detection.

## Browser worker

The production build writes a worker and an ES module client to `dist/`. Serve
both from a location allowed by your application's worker and Content Security
Policy settings:

```js
import { Carta1Worker } from '/vendor/carta1-worker-interface.min.js'

const codec = new Carta1Worker('/vendor/carta1-worker.min.js')

const { aeaBlob } = await codec.encode([left, right], {
  allocationBias: 1.0,
})
const parsed = await codec.parseAeaBlob(aeaBlob)
const { wavBlob, info } = await codec.decode({
  aeaData: parsed.frameData,
  info: parsed.info,
})
const optionMetadata = await codec.getEncoderOptions()

codec.terminate()
```

Always call `terminate()` when the worker is no longer needed. The build also
produces `dist/carta1.min.js`, a UMD bundle exposing the main JavaScript API as
the global `Carta1` object.

## Compatibility and limitations

- Encoding is fixed to the 44.1 kHz ATRAC1 profile described above; Carta1 does
  not resample input.
- JavaScript APIs use normalized planar PCM. Web Audio channel data already
  follows this convention.
- Stateful frame APIs must receive frames in order and must not be shared by
  independent streams.
- AEA stores whole frames rather than an exact source sample count, so a final
  partial frame is represented with zero padding.
- Browser worker assets must be served from a location permitted by the page's
  worker and Content Security Policy rules.

## Development

Implementation concerns are split without hiding the top-level pipeline:

| Path                | Responsibility                                      |
| ------------------- | --------------------------------------------------- |
| `codec/pipeline/`   | Ordered encoder and decoder stage composition.      |
| `codec/analysis/`   | Transient analysis and encoder decisions.           |
| `codec/coding/`     | Bit allocation and quantization.                    |
| `codec/transforms/` | FFT, QMF, MDCT, and inverse transforms.             |
| `codec/io/`         | Bitstreams, AEA serialization, and stream adapters. |
| `codec/core/`       | Constants, options, and reusable buffer ownership.  |
| `codec/browser/`    | Web Worker implementation and client.               |
| `bin/`              | Command-line boundary.                              |
| `tests/`            | Unit, serialization, and pipeline tests.            |

Common commands are:

```bash
npm test            # Run the test suite once
npm run test:watch  # Re-run tests while editing
npm run lint        # Check JavaScript and formatting
npm run format      # Apply repository formatting
npm run build       # Build the three browser bundles
npm run check       # Run lint, tests, and the production build
```

Run `npm run check` before submitting a change. Pull requests and pushes run
the same gate in CI.

## Acknowledgements

This project would not have been possible without
[AtracDEnc](https://github.com/dcherednik/atracdenc) by
[Daniel Cherednik](https://github.com/dcherednik), the reference ATRAC
implementation used to understand the ATRAC1 format and codec behavior.

## License

ISC
