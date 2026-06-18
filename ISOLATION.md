# Agent Machine — isolation architecture

The Agent Machine is the isolated runtime that ships and runs the model-serving
stack **inside its own boundary**. The user installs Noetica and it works — no host
Ollama, no `ollama pull`, no system model dir. The app **profiles the box at setup
and picks the strongest tier it can run well, by default** (no manual knob).

## Tier ladder (strongest first)

| Tier | macOS | Linux | GPU | Isolation |
|---|---|---|---|---|
| **T1 vm** | Podman machine (krunkit/libkrun) | microVM / Podman machine | venus-Vulkan (mac) · NVIDIA CDI (linux) | HW kernel boundary (strongest) |
| **T2 container** | seatbelt (`sandbox-exec`) around the app's *own* managed Ollama | rootless Podman container (namespaces + seccomp + cgroups) | Metal (mac, native) · NVIDIA (linux) | MAC policy (mac) / Linux namespaces (linux) |
| **T3 process** | bare host process | bare host process | native | none — dev only, never a default |

**macOS nuance:** Linux containers/namespaces don't exist on the mac host — a Podman
*container* on a Mac runs *inside* the Podman-machine VM (so it's T1, not a lighter
tier). The real lighter-but-isolated Mac tier is **seatbelt around the app's managed
Ollama** (shared kernel, MAC-confined, Metal-accelerated). The earlier mistake was
falling back to the *user's* Ollama; T2 ships and confines **our own**.

## Opinionated selection (`lib/host-profile.ts`, unit-tested)
- **Linux + NVIDIA** → T2 rootless container + CDI GPU. (Linux, no GPU → container CPU.)
- **macOS ≥ 16 GB + krunkit** → **T1 Podman VM + venus-Vulkan GPU** (strongest *and* fast).
- **macOS otherwise** (this 8 GB box, or no krunkit) → **T2 seatbelt + native Metal**
  (fast, isolated, zero VM overhead) — never a slow CPU-in-VM by default.
- **Model ceiling by RAM:** < 12 GB → 3B · 12–24 GB → 7B · ≥ 24 GB → 8B+ suite.

Live: `GET /api/host/profile` returns the profile + chosen tier; logged at boot.

## krunkit/Vulkan spike verdict (PM1 — conclusive)
On Apple Silicon, `applehv` can't pass the GPU to a Linux guest, but **`krunkit`
(libkrun) can**: with a libkrun Podman machine, the guest gets `/dev/dri/renderD128`
(virtio-gpu) and the **venus Vulkan ICD** (`libvulkan_virtio.so`) loads. Full GPU
enumeration + tok/s benchmark were blocked **only by this box's 8 GB RAM**
(`vkCreateInstance` → `ERROR_OUT_OF_HOST_MEMORY`), not by capability. The robust
Mac-GPU-in-VM path is real (same mechanism as RedHat's `ramalama`); validate perf on
a 16 GB+ box. In-VM GPU engine should be **llama.cpp-server (Vulkan)**, not Ollama
(Ollama's Vulkan is experimental); Ollama stays for the CPU/NVIDIA/native providers.

## Built so far
- `lib/host-profile.ts` — profiler + opinionated `selectIsolationTier` (+ tests)
- `GET /api/host/profile` + boot log
- `docker-compose.yml` — containerized `ollama` service (model plane inside the
  boundary, `ollama-models` volume), agent-machine wired to it via internal DNS

## Next (PM3)
- Podman-machine provisioner (Tauri shell): ensure machine, safe resources, `compose up`
- seatbelt profile for the T2 managed-Ollama provider
- krunkit/Vulkan + llama.cpp-server T1 provider; first-run model provisioning UX
- Retire the system-Ollama fallback + host LaunchAgent (replaced by T2 managed runtime)
