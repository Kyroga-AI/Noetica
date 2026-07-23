/**
 * Host profiler + opinionated isolation-tier selector.
 *
 * The Agent Machine adapts its isolation to the hardware at setup. There is no
 * manual knob: the app profiles the box and picks the STRONGEST tier it can
 * actually run well, then provisions that by default.
 *
 * Isolation tiers (strongest first):
 *   T1 vm        — Podman-machine microVM (HW kernel boundary). GPU via krunkit/
 *                  venus-Vulkan (macOS) or NVIDIA CDI (Linux). Needs RAM headroom.
 *   T2 container — Linux: rootless Podman container (namespaces+seccomp+cgroups).
 *                  macOS has no Linux namespaces, so the T2 analog is a seatbelt
 *                  (sandbox-exec) profile around the app's OWN managed Ollama —
 *                  shared kernel but MAC-confined, and Metal-accelerated (fast).
 *   T3 process   — bare host process. Dev only; never a chosen default.
 *
 * Opinionated policy, in one place and unit-tested. Detection is separate from
 * selection so the policy is deterministic and testable without real hardware.
 */
import * as os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export type IsolationTier = 'vm' | 'container' | 'process'
export type ProviderId =
  | 'podman-vm-krunkit'   // macOS VM + venus Vulkan GPU
  | 'podman-vm-cpu'       // VM, CPU only
  | 'podman-container-nvidia' // Linux rootless container + NVIDIA
  | 'podman-container-cpu'    // Linux rootless container, CPU
  | 'seatbelt-native-metal'   // macOS sandboxed managed Ollama, Metal GPU
  | 'host-process'            // dev only

export interface HostProfile {
  os: 'darwin' | 'linux' | 'win32' | 'other'
  arch: string
  totalRamGb: number
  cpus: number
  gpu: { metal: boolean; nvidia: boolean }
  virtualization: { podman: boolean; krunkit: boolean }
}

export interface IsolationSelection {
  tier: IsolationTier
  provider: ProviderId
  gpu: 'metal' | 'vulkan-venus' | 'nvidia' | 'none'
  /** Largest model class this box should default to (RAM-bounded). */
  modelCeiling: 'small-3b' | 'mid-7b' | 'large-8b-plus'
  recommendedModels: string[]
  rationale: string
}

// ── Detection (impure; reads the real box) ──────────────────────────────────

async function has(bin: string): Promise<boolean> {
  try { await exec('command', ['-v', bin], { shell: '/bin/bash' as unknown as undefined }); return true } catch { return false }
}
async function whichOk(bin: string): Promise<boolean> {
  try { const { stdout } = await exec('/usr/bin/which', [bin]); return stdout.trim().length > 0 } catch { return false }
}
async function nvidiaPresent(): Promise<boolean> {
  try { await exec('nvidia-smi', ['-L']); return true } catch { return false }
}

export async function profileHost(): Promise<HostProfile> {
  const platform = process.platform
  const osName: HostProfile['os'] = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : platform === 'win32' ? 'win32' : 'other'
  const totalRamGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10
  const [podman, krunkit, nvidia] = await Promise.all([
    whichOk('podman'),
    whichOk('krunkit'),
    osName === 'linux' ? nvidiaPresent() : Promise.resolve(false),
  ])
  void has // (kept for future capability probes)
  return {
    os: osName,
    arch: process.arch,
    totalRamGb,
    cpus: os.cpus().length,
    gpu: { metal: osName === 'darwin', nvidia },
    virtualization: { podman, krunkit },
  }
}

// ── Selection (pure; opinionated; unit-tested) ──────────────────────────────

const VM_MIN_RAM_GB = 16   // below this, a model-serving VM thrashes — prefer native

function modelCeiling(ramGb: number): IsolationSelection['modelCeiling'] {
  if (ramGb < 12) return 'small-3b'
  if (ramGb < 24) return 'mid-7b'
  return 'large-8b-plus'
}
function recommendedModels(ceiling: IsolationSelection['modelCeiling']): string[] {
  switch (ceiling) {
    case 'small-3b': return ['llama3.2:3b', 'nomic-embed-text']
    case 'mid-7b': return ['qwen2.5:7b', 'nomic-embed-text']
    case 'large-8b-plus': return ['qwen2.5:7b', 'deepseek-r1:8b', 'qwen2.5-coder:7b', 'nomic-embed-text']
  }
}

/**
 * Pick the strongest tier the box can run WELL, by default. Opinionated:
 *  - More horsepower ⇒ stronger isolation (VM) automatically.
 *  - Never default to a tier that would be unusably slow (e.g. CPU-in-VM on a Mac):
 *    a fast, sandboxed, Metal-accelerated native runtime beats a slow "more isolated" VM.
 */
export function selectIsolationTier(p: HostProfile): IsolationSelection {
  const ceiling = modelCeiling(p.totalRamGb)
  const models = recommendedModels(ceiling)

  if (p.os === 'linux') {
    if (p.gpu.nvidia) {
      return { tier: 'container', provider: 'podman-container-nvidia', gpu: 'nvidia', modelCeiling: ceiling, recommendedModels: models,
        rationale: `Linux + NVIDIA: rootless container (namespaces+seccomp) with CDI GPU passthrough — strong isolation and full acceleration.` }
    }
    return { tier: 'container', provider: 'podman-container-cpu', gpu: 'none', modelCeiling: ceiling, recommendedModels: models,
      rationale: `Linux, no NVIDIA: rootless container (namespaces+seccomp), CPU inference.` }
  }

  if (p.os === 'darwin') {
    // Strongest Mac tier: full VM with in-VM GPU — only when there's RAM headroom
    // AND the krunkit/venus path is installed (else a CPU-in-VM would be too slow).
    if (p.totalRamGb >= VM_MIN_RAM_GB && p.virtualization.podman && p.virtualization.krunkit) {
      return { tier: 'vm', provider: 'podman-vm-krunkit', gpu: 'vulkan-venus', modelCeiling: ceiling, recommendedModels: models,
        rationale: `macOS ${p.totalRamGb}GB + krunkit: Podman microVM with venus-Vulkan GPU — strongest isolation AND GPU acceleration.` }
    }
    // Otherwise prefer fast, sandboxed, Metal-accelerated native over a slow CPU-VM.
    return { tier: 'container', provider: 'seatbelt-native-metal', gpu: 'metal', modelCeiling: ceiling, recommendedModels: models,
      rationale: `macOS ${p.totalRamGb}GB${p.virtualization.krunkit ? '' : ' (no krunkit)'}: seatbelt-sandboxed managed Ollama with Metal GPU — `
        + `fast and isolated without VM overhead. Install krunkit + ≥${VM_MIN_RAM_GB}GB for full VM isolation.` }
  }

  if (p.os === 'win32') {
    // Honest Windows tier until the sandbox lattice lands (WSL2 → Windows Sandbox → Job
    // Objects): a bare host process, SAID OUT LOUD. Downstream code-execution lanes treat
    // 'host-process' as unsandboxed and require the explicit unsafe opt-in.
    return { tier: 'process', provider: 'host-process', gpu: 'none', modelCeiling: ceiling, recommendedModels: models,
      rationale: `Windows: NO sandbox tier implemented yet — bare host process. Agent code-execution stays disabled unless NOETICA_ALLOW_UNSANDBOXED=1.` }
  }
  return { tier: 'process', provider: 'host-process', gpu: 'none', modelCeiling: ceiling, recommendedModels: models,
    rationale: `Unrecognized platform — bare host process (dev only).` }
}
