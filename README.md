# Carta1

An ATRAC1 audio codec implementation in JS.

## Features

- Pure JavaScript implementation of ATRAC1 codec
- Encoding WAV to AEA (ATRAC1) format
- Decoding AEA to WAV format
- Command-line interface
- Browser-compatible with Web Workers
- Streaming support for large files

## Installation

```bash
npm install carta1
```

## CLI Usage

### Encoding

```bash
carta1 --encode input.wav output.aea
```

### Decoding

```bash
carta1 --decode input.aea output.wav
```

### Options

- `-e, --encode` - Encode WAV to AEA
- `-d, --decode` - Decode AEA to WAV
- `-j, --json` - Dump AEA file structure to JSON
- `-q, --quiet` - Suppress all output except errors
- `-f, --force` - Overwrite output file if it exists
- `-t, --title <title>` - Custom title for AEA file metadata (encoding only)

## Browser Usage

```html
<script src="https://unpkg.com/carta1/dist/carta1-worker.min.js"></script>
<script src="https://unpkg.com/carta1/dist/carta1-worker-interface.min.js"></script>
```

```javascript
// Create codec instance
const codec = new Carta1Worker('carta1-worker.min.js')

// Encode PCM to ATRAC1
const result = await codec.encode(pcmData, options)

// Decode ATRAC1 to PCM
const wavData = await codec.decode(aeaData)

// Clean up
codec.terminate()
```

## API Reference

### Node.js

```javascript
import { encode, decode, AudioProcessor } from 'carta1'

// Encode PCM frames
const encoder = encode(options)
const encodedFrame = encoder(pcmFrame)

// Decode ATRAC1 frames
const decoder = decode()
const pcmFrame = decoder(encodedFrame)
```

### Browser Worker API

#### `new Carta1Worker(workerPath)`

Create a new codec worker instance.

#### `encode(pcmData, options)`

Encode PCM audio data to ATRAC1 format.

#### `decode(aeaData)`

Decode ATRAC1 data to PCM format.

#### `parseAeaBlob(blob)`

Parse AEA file blob to extract metadata.

#### `terminate()`

Clean up worker resources.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build minified versions
npm run build

# Lint code
npm run lint

# Format code
npm run format
```

## Acknowledgements

This project would not have been possible without:

- [**AtracDEnc**](https://github.com/dcherednik/atracdenc) by [Daniel Cherednik](https://github.com/dcherednik) - The reference ATRAC implementation that provided invaluable insights into the codec's inner workings and served as the primary source for understanding the ATRAC1 format specification.

## License

ISC
