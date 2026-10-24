# Porffor investigation

Carta1 can compile to machine code with Porffor alpha 19. The initial
unadapted CLI failed at Node filesystem imports, and the public package failed
at startup without TextEncoder. A native host now supplies the required
operations; see [native builds, verification and release assets](native.md).

The original frame-only test on macOS ARM64 used Carta1 1.5.0, Node 24.11.1,
Apple Clang 16.0.0, and Porffor `alpha 19 (0c135ce 2026-10-21)`
([compiler source](https://github.com/CanadaHonk/porffor/tree/0c135ce2f36fdd3467d5a58daa92283810705a51)).
All 288 channel frames encoded identically under default C flags, but 8,708
decoded float32 samples differed, with maximum absolute error about `1.19e-7`.
Disabling C floating-point contraction restored exact sample-bit parity.
The matched frame output SHA-256 was
`413f72d3f2e1c7735f831e7c637b49d7757b3f76b6ff8df16fb8ee36a572a57d`.

The repeatable `npm run probe:porffor` command now includes native host
initialization and CLI help, and succeeds when those checks and strict frame
parity pass. It keeps its binaries, complete output records, build logs and
`report.json` in the printed temporary directory. It does not download a
compiler or produce release assets. `npm run test:native` supplies the actual
WAV/AEA release gate, including long-file coverage for the compiler runtime's
async-generator limitation.
