# Matrix Workroom substrate — integration plan ("what's it gonna take")

Workrooms become a real **Matrix**-backed substrate (multi-user, federated-capable, sovereign), and the
IRC/slash commands flow through it. Good news: **our IRC layer is already Matrix-shaped** — Matrix models
`/me` as the `m.emote` msgtype natively, so `lib/chat/matrix-shim.ts` maps IRC → Matrix with no impedance.

## What it'll take (MVP → real)

### 1. Lightweight homeserver — **Conduit** (recommended)
Single Rust binary, RocksDB/SQLite, tens of MB — matches our sidecar pattern (`noetica-embed`, voice). Two
deploy modes:
- **Sidecar** (preferred): bundle the `conduit`/`conduwuit` binary, spawn it like our other sidecars on a
  local port (default 6167), data under `~/.noetica/matrix/`. Needs `tauri-plugin-shell` (already a known gap —
  see [[noetica-mcp-a2a-zero-trust]]).
- **Container**: ship a `docker-compose`/OCI image for users who prefer it (lattice-forge RuntimeAsset).
Avoid Synapse (Python, heavy). Dendrite (Go) is the fallback.

### 2. Client SDK in the app
`matrix-js-sdk` (or a thin REST client over the Client-Server API) to: login (sovereign identity), create/join
rooms (= Workrooms), send/receive `m.room.message` events, sync. ~1 day to a working send/receive loop.

### 3. Workroom ↔ Matrix adapter
Map a Workroom to a Matrix room; our chat messages ↔ `m.room.message` events via `matrix-shim.toMatrixEvent`.
IRC commands → msgtypes (`msgTypeFor`): `/me`→`m.emote`, system→`m.notice`, else `m.text`. Slash commands run
locally (dialogue layer) and their *results* post as `m.notice`.

### 4. Substrate-agnostic command bus
The dialogue/command layer already returns structured results; route them to EITHER the local chat OR the
active Matrix room. One emit point, two sinks — so every `/` `@` `.` `#` command works identically in
Workrooms.

### 5. Identity + governance
Reuse the sovereign device identity (Phase-3a audit key) as the Matrix login credential / SSO. Gate room
egress through SCOPE-D ([[noetica-scope-d-integration]]) — federation off by default (local-only homeserver),
opt-in per room.

## Estimate
- Send/receive + emote mapping (shim done): **~1 day**
- Conduit sidecar spawn + lifecycle (blocked on `tauri-plugin-shell`): **~1 day**
- Workroom↔room adapter + command bus: **~2 days**
- Identity/SSO + SCOPE-D egress gate: **~1–2 days**
MVP "Workrooms on Matrix, IRC commands native": **~1 week**, gated mainly on `tauri-plugin-shell` for the sidecar.

## Done already
- `lib/chat/matrix-shim.ts` — IRC→Matrix msgtype mapping, event builder, homeserver options (Conduit), target config. Tested.
- IRC + slash + `@`/`.`/`#` sigil commands (`lib/chat/{slash-commands,command-registry,sigils}.ts`) — substrate-ready.
