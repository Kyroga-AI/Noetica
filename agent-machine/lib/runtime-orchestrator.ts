/**
 * First-run bootstrap orchestrator.
 *
 * Turns a hardware profile into a concrete plan for standing up the model runtime
 * with zero host setup: which isolation provider, whether to provision the runtime,
 * which models to pull, and the endpoint the agent-machine should target. The plan
 * is pure (unit-tested); the executor (scripts/bootstrap.ts) runs the steps using
 * the already-verified provision/launch/pull pieces.
 */
import { selectIsolationTier, type HostProfile, type IsolationSelection } from './host-profile.js'
import { MANAGED_PORT } from './managed-ollama.js'

export interface BootstrapPlan {
  selection: IsolationSelection
  /** Download the complete Ollama runtime into ~/.noetica/runtime (macOS T2). */
  provisionRuntime: boolean
  /** Bring up a Podman machine + compose (T1 VM / Linux container). */
  provisionMachine: boolean
  /** Models to pull (recommended-minus-installed), into the runtime's model store. */
  modelsToPull: string[]
  /** Endpoint the agent-machine should target (OLLAMA_HOST). */
  endpoint: string
  steps: string[]
}

export function planBootstrap(profile: HostProfile, installedModels: string[] = []): BootstrapPlan {
  const selection = selectIsolationTier(profile)
  const installed = new Set(installedModels.map((m) => m.split(':')[0]))
  const modelsToPull = selection.recommendedModels.filter((m) => !installed.has(m.split(':')[0]!))

  const isManagedNative = selection.provider === 'seatbelt-native-metal' || selection.provider === 'host-process'
  const isVmOrContainer = selection.tier === 'vm' || selection.provider.startsWith('podman-container')

  const provisionRuntime = profile.os === 'darwin' && isManagedNative
  const provisionMachine = isVmOrContainer
  // T2 native + VM both expose Ollama on the isolated port locally; container/VM map it out.
  const endpoint = `http://127.0.0.1:${MANAGED_PORT}`

  const steps: string[] = []
  if (provisionRuntime) steps.push('provision complete Ollama runtime → ~/.noetica/runtime (binary + llama-server)')
  if (provisionMachine) steps.push(`provision Podman machine + compose up (${selection.provider})`)
  steps.push(modelsToPull.length ? `pull models: ${modelsToPull.join(', ')}` : 'models already present')
  steps.push(provisionMachine ? 'start containerized model plane' : 'launch sandboxed managed Ollama (seatbelt)')
  steps.push(`point agent-machine at ${endpoint}`)

  return { selection, provisionRuntime, provisionMachine, modelsToPull, endpoint, steps }
}
