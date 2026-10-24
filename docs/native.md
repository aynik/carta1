# Native Carta1 CLI

Carta1's native CLI compiles the JavaScript codec to machine code with Porffor.
The executable uses the OS C runtime and does not require Node.js. JavaScript
packages and browser bundles continue to ship separately.

## Download and run

GitHub Releases include `carta1-VERSION-OS-ARCH.tar.gz` and a matching `.sha256`
file. Targets are `linux-x64`, `linux-arm64`, `darwin-x64`, and `darwin-arm64`.
Linux builds target Ubuntu 24.04/glibc; macOS ARM64 builds target macOS 14 and
Intel builds target macOS 15. Native Windows and musl builds are not included.

Extract the archive and run its `carta1` executable:

```sh
./carta1 --encode input.wav output.aea
./carta1 --decode input.aea output.wav
./carta1 --json input.aea structure.json
./carta1 --help
```

The native CLI accepts the Node CLI's encode/decode/JSON operations and its
quiet, force, UTF-8 title, allocation bias, and fixed block mode options.
WAV input is mono/stereo signed little-endian 16/24/32-bit integer PCM.
Decoding writes PCM16 WAV. Input is normally 44.1 kHz; other rates trigger a
warning and are not resampled. JSON inspection escapes non-ASCII characters
as Unicode escapes, preserving the same parsed data as Node.

The native adapter processes complete files in memory and prints a completion
line instead of an interactive progress bar. The Node CLI remains available
for stream-based input processing. Existing output files require `--force`.
The archive contains the executable, build metadata, this guide, Carta1's ISC
license, and the Porffor runtime's MIT license.

## Build and verify

From the repository checkout, with Node.js and a system C compiler installed:

```sh
npm ci
node build/install-porffor.js /tmp/carta1-toolchain
export PORFFOR=/tmp/carta1-toolchain/porf
npm run build:native
npm run probe:porffor
npm run test:native
npm run package:native
```

The installer pins Porffor alpha 19 (`0c135ce`) and verifies the downloaded
archive against a checked-in SHA-256. It does not change shell configuration.
`PORFFOR` can instead select an already installed copy of that exact version.
`CC` may select a C compiler executable without arguments.

`build:native` writes `dist/native/carta1` and `build-info.json`. Its optional
argument selects another binary output path. Compilation uses a temporary
source tree and hardcodes the package version, so the executable needs no
adjacent JavaScript files or `package.json`. C compilation always uses
`-fno-fast-math -ffp-contract=off`: default floating-point contraction changed
decoded sample bits in the initial experiment. Generated native files are
excluded from the npm package.

`probe:porffor` checks exact encoded bytes and float32 reconstruction bits for
288 channel frames, public package startup with the native host, and native
CLI help. `test:native` runs 57 WAV/AEA cases against the actual Node CLI,
including independent stereo state, 16/24/32-bit input, partial/empty files,
block modes and bias, UTF-8 titles and paths, JSON data, overwrite behavior,
invalid input, and a 20-second stereo case that exercises garbage collection.
Encoded AEA and decoded WAV files must match byte for byte.

To include external corpus files and retain hash evidence:

```sh
CARTA1_NATIVE_CORPUS=/absolute/castanets.wav:/absolute/music.wav \
CARTA1_KEEP_NATIVE_EVIDENCE=1 npm run test:native
```

Use the root harness with a native CLI adapter and `--jobs 1` for final ODG
comparisons. Native release jobs also run the frame and file parity gates on
each target machine before uploading archives.

## Host implementation

`native/host.js` supplies argument decoding, bounded binary reads, exclusive
output creation, the UTF-8 operations needed by AEA titles, and the byte Blob
operations used by the existing PCM facade. Its small C bridge relies on the
pinned Porffor runtime's ArrayBuffer layout. The native CLI imports
`codec/index.js` and reuses the existing container, serialization, timeline,
and PCM conversions. WAV sample conversion and JSON inspection are shared
with the Node CLI; the codec algorithm is unchanged.

Complete-file helpers use synchronous frame operations on the same stateful
stream classes used by async callers. This avoids a Porffor alpha 19
async-generator queue crash on longer audio without disabling garbage
collection or duplicating priming, tail flushing, or source-length trimming.
Their public Promise-returning API is unchanged. The host's UTF-8 and Blob
classes implement the surface needed by Carta1, rather than a general browser
or Node compatibility layer.

## GitHub release gate

The reusable Native binaries workflow builds and tests all four targets on
native GitHub runners. It runs in CI and is required by the tag-triggered
publishing workflow. A failed native parity check prevents publishing.
Successful jobs package versioned archives, build metadata, licenses, and
SHA-256 checksums; the publishing job attaches them alongside browser/WME
assets. The existing version-bump workflow still controls versioning and tags.
