import { evidenceHash } from '@/lib/evidence/hash'
import type { NoeticaTaskInput, NoeticaTaskResult } from '@/lib/types/task'

export type { NoeticaTaskInput, NoeticaTaskResult } from '@/lib/types/task'

// Authority boundary: Noetica owns this adapter interface only. Real routing and
// task execution belong to github.com/SocioProphet/superconscious. Tool grants
// belong to github.com/SocioProphet/agent-registry, model routing belongs to
// github.com/SocioProphet/model-router, policy admission belongs to guardrail /
// policy fabric, memory belongs to github.com/SocioProphet/memory-mesh, and
// evidence / replay authority belongs to github.com/SocioProphet/agentplane.
export async function submitTask(input: NoeticaTaskInput): Promise<NoeticaTaskResult> {
  const started = Date.now()

  if (input.mode === 'standalone') {
    return stubStandaloneBypass(input, started)
  }

  return stubSourceOSNotAvailable(input, started)
}

function stubStandaloneBypass(input: NoeticaTaskInput, started: number): NoeticaTaskResult {
  const timestamp = new Date().toISOString()

  return {
    schema_version: 'noetica.task.v0.1',
    status: 'stubbed',
    run_id: `standalone-bypass-${crypto.randomUUID()}`,
    content: 'Standalone mode bypasses the Superconscious adapter. Direct provider calls are handled by Noetica local standalone routing.',
    model_routed: input.model_hint ?? 'standalone-provider-router',
    provider: 'noetica-standalone',
    model_overridden: false,
    policy_admitted: true,
    policy_ref: 'noetica://standalone/local-policy',
    grant_refs: {
      requested: input.tool_grant_refs,
      resolved: [],
      missing: input.tool_grant_refs
    },
    memory_written: false,
    memory_scope_ref: input.memory_scope_ref,
    evidence_ref: input.agentplane_evidence_ref ?? 'agentplane://not-used/standalone-bypass',
    request_hash: input.request_hash,
    evidence_hash: evidenceHash({
      mode: input.mode,
      request_hash: input.request_hash,
      status: 'stubbed',
      timestamp
    }),
    timestamp,
    latency_ms: Date.now() - started
  }
}

function stubSourceOSNotAvailable(input: NoeticaTaskInput, started: number): NoeticaTaskResult {
  const timestamp = new Date().toISOString()
  const runId = `sourceos-unavailable-${crypto.randomUUID()}`

  return {
    schema_version: 'noetica.task.v0.1',
    status: 'unavailable',
    run_id: runId,
    content:
      'SourceOS mode is not yet available for Noetica. Superconscious live submission, agent-registry grant resolution, model-router decisions, memory-mesh writes, and agentplane replay emission are pending M3 integration.',
    model_routed: input.model_hint ?? 'model-router-pending',
    provider: 'superconscious',
    model_overridden: false,
    policy_admitted: false,
    policy_ref: 'guardrail-fabric://pending/noetica-m3-contract-stub',
    grant_refs: {
      requested: input.tool_grant_refs,
      resolved: [],
      missing: input.tool_grant_refs
    },
    steering_applied: input.steering_hint
      ? {
          status: 'noop',
          baseline: input.message,
          steered: input.message,
          diff_summary: 'SourceOS contract stub records steering intent but applies no runtime intervention.',
          feature_id: input.steering_hint.feature_id,
          layer: input.steering_hint.layer,
          strength: input.steering_hint.strength
        }
      : undefined,
    memory_written: false,
    memory_scope_ref: input.memory_scope_ref,
    agentplane_run_id: undefined,
    evidence_ref: 'agentplane://pending/noetica-sourceos-contract-stub',
    replay_ref: 'agentplane://pending/noetica-replay-plan',
    request_hash: input.request_hash,
    evidence_hash: evidenceHash({
      mode: input.mode,
      request_hash: input.request_hash,
      run_id: runId,
      status: 'unavailable',
      timestamp
    }),
    timestamp,
    latency_ms: Date.now() - started
  }
}
