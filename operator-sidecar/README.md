# noetica-operator — on-device neural-operator inference

Noetica's sovereign inference path for **neural operators** (Fourier Neural Operators and friends): a tiny
Rust HTTP sidecar wrapping `tract` (a **pure-Rust** ONNX runtime — no prebuilt binary, so it cross-compiles to
every target, which is what lets it ship in the universal app bundle). Train an operator **offline**, export it
to a single `.onnx`, drop it in the operator dir, and it runs **fully on-device — no Python, no cloud**. It is the same
sidecar shape as `embed-sidecar` (lazy-spawned, localhost HTTP, graceful fallback), and it is **model-agnostic**:
every `.onnx` flows through the identical code path.

## Why neural operators

Operators learn maps between *function spaces* and are **resolution-invariant** — train at one grid, evaluate
at any grid. The payoff for a local-first app: a trained operator is a **millisecond forward pass** that
replaces a cloud HPC simulation. The target surface is the GAIA environmental map (flood depth, dispersion,
hydrology, sensor-field interpolation), where OFIF markers supply the inputs and the output field is rendered
as a map overlay. The serving stack here is that surface's compute substrate — and is reusable by any caller.

## Wire contract

| Method / path           | Body / query                                              | Response |
|-------------------------|-----------------------------------------------------------|----------|
| `GET /health`           | —                                                         | `{"ok":true,"models":[...]}` |
| `GET /models`           | —                                                         | `{"models":[...]}` |
| `GET /meta?model=NAME`  | —                                                         | `{"model","inputs":[{name,shape,dtype}],"outputs":[...]}` (a `null` dim is dynamic) |
| `POST /infer`           | `{"model":NAME,"inputs":{NAME:{"shape":[..],"data":[..]}}}` | `{"outputs":{NAME:{"shape":[..],"data":[..]}},"ms":N}` |

Tensors are dense, **row-major f32**; `data.length` must equal the product of `shape`. The TypeScript client
is `agent-machine/lib/operator-runtime.ts` (lazy-spawn, validation, typed errors, `tryOperatorInfer` for
graceful degradation).

## Config

| Env | Default | Purpose |
|-----|---------|---------|
| `NOETICA_OPERATOR_PORT` | `8127` | listen port |
| `NOETICA_OPERATOR_DIR`  | `~/.noetica/operators` | where `<name>.onnx` models live |
| `NOETICA_OPERATOR_BIN`  | — | explicit binary path (packaging / tests); `''` forces "unavailable" |

## Build & run

```sh
cargo build --release                 # pure Rust, no prebuilt download — one shippable binary, any target
NOETICA_OPERATOR_DIR=./models ./target/release/noetica-operator
curl localhost:8127/health
```

## Adding a model

- **Test fixtures (no training):** `python scripts/make_reference_model.py` → `models/identity.onnx`,
  `models/smooth.onnx`. These are tiny, deterministic, and dynamic-shape — they exercise the full serving path
  and back the integration test, so they're checked in.
- **A real FNO (the production recipe):** `scripts/train_fno.py` trains a 2D FNO and exports it with dynamic
  spatial axes. Swap its `make_batch` for `(input, output)` pairs from your PDE solver. Needs `torch`.
  ⚠️ **Backend caveat:** `tract`'s FFT/`DFT` op coverage is limited, so an FNO that exports explicit spectral
  (rfft/irfft) ops may not load. The Conv/U-Net-style operators (and the reference fixtures) run fine. If a
  trained FNO needs DFT, either export it without explicit FFT ops or revisit the backend (a real ONNX-Runtime
  build for the platforms that have prebuilts) — the serving contract is unchanged either way.

## Provisioning models onto a device

The serving **binary** ships in the app bundle (Tauri externalBin, alongside `noetica-embed` — see
`scripts/inject-am-sidecar-config.mjs` + `release.yml`). The **models** are delivered separately (large +
versioned independently) via `agent-machine/lib/operator-provision.ts`:

```
POST /api/operator/provision { "name": "diffusion-fno" }   # SSE progress, token-gated
```

Source resolution: `NOETICA_OPERATOR_<NAME>_URL` env override → optional manifest
(`NOETICA_OPERATOR_MANIFEST_URL`, `{models:{name:{url,sha256,version}}}`) → the release asset
`<name>-operator.onnx`. Downloads are **https-only** (loopback http allowed for tests), **sha256-verified** when
a checksum is known, and installed **atomically** (temp → rename) so the sidecar never sees a partial file.

## Tests

- `agent-machine/lib/operator-runtime.test.ts` — runtime contract against a mock sidecar (no binary).
- `agent-machine/lib/operator-provision.test.ts` — model download/verify/atomic-install (loopback mock).
- `agent-machine/scripts/integration-operator.test.ts` — the **real** runtime driving the **real** binary
  against the fixtures (`npm run test:integration:operator`); skips cleanly when the binary isn't built.
