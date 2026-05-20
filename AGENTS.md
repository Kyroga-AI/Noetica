# Noetica — Agent Instructions

Noetica is the governed chat surface for the SocioProphet / SourceOS stack.
It sits at the same tier as TurtleTerm, BearBrowser, and AgentTerm.

## Stack

- Next.js 14 App Router
- TypeScript
- Tailwind CSS
- Zustand

## Key boundaries

- Noetica does NOT own memory. Memory is memory-mesh's authority.
- Noetica does NOT own model routing. That is model-router's authority.
- Noetica does NOT own policy admission. That is guardrail-fabric's authority.
- Noetica DOES own: the chat surface, the steering UX, the governance trail display,
  the provider abstraction layer, and the Superconscious adapter interface.

## Modes

- standalone: direct provider API calls, no Superconscious dependency
- sourceos: submit NoeticaTaskInput to Superconscious adapter

## Model steering capability tiers

Do not use a boolean steering abstraction. Model steering is a three-tier capability:

- `full`: full white-box SAE steering. The model has activation access and a usable SAE source, such as Neuronpedia. The UI may show feature search, layer selection, strength controls, and baseline-vs-steered diff.
- `local`: open-weight / partial white-box path. SAE steering may be possible through Agent Machine local inference or a custom SAE, but not through a hosted blackbox API. In standalone mode this must render as unavailable or pending.
- `none`: blackbox provider path. Claude, OpenAI, Gemini, Grok, and similar APIs do not expose activations. Noetica must not claim SAE steering. Show governed provenance, route, latency, policy, and evidence/tamper state instead.

Never represent prompt engineering, system prompts, or few-shot examples as SAE steering. Those are behavioral controls, not mechanistic activation steering.

## Model registry authority

`config/models.ts` is a temporary local registry for M1/M2 development. It is not the long-term authority for model capabilities. As Agentplane's `capability-registry` matures, steering capability declarations should migrate there and Noetica should become a read-through adapter or cached view over Agentplane capability records.

## Agentplane evidence alignment

Standalone external-provider calls should emit Agentplane-compatible `ExternalModelProviderRouteEvidence` alongside Noetica's local request/evidence hashes. Keep the Agentplane object schema-compatible: do not add unsupported completion or exchange fields inside it. Completion/exchange commitments remain Noetica governance fields until Agentplane defines a compatible completion evidence schema.

## M3 Superconscious contract

M3 prep defines contract shape, not live SourceOS runtime. `NoeticaTaskInput` and `NoeticaTaskResult` live in `lib/types/task.ts` and are the canonical Noetica-side SourceOS contract until a shared schema exists.

The SourceOS path must carry explicit authority references:

- `agent_id: "noetica"` anchors to the agent-registry manifest.
- `tool_grant_refs` declares required grants without claiming admission.
- `request_hash` is computed before Superconscious receives the task.
- model routing, policy admission, memory decisions, replay, and evidence refs must remain separate fields.

SourceOS mode is currently stubbed. The stub must return a typed `NoeticaTaskResult` with `status: "unavailable"` and `policy_admitted: false`, not throw. Live Superconscious submission, model-router calls, memory writes, grant resolution, credentials, and Agentplane replay emission are M3 runtime work and must not be claimed in M3 prep.

## Steering result states

`SteeringResult.status` must be explicit:

- `applied`: a real steering backend applied the requested steering.
- `not_configured`: required steering credentials or backend are absent.
- `noop`: the adapter accepted steering intent but deliberately applied no runtime intervention.

No silent steering failure is allowed.

## M2 milestone split

M2a is live standalone chat and must not require `NEURONPEDIA_API_KEY`.
M2b is real steering diff and requires a configured steering backend capable of returning `status: "applied"`.

## Feature search

M2b should include a feature-search path for Neuronpedia or another SAE source where available. This is a SHOULD, not a blocker for the first `status: "applied"` demonstration.

## Palette

```css
--noetica-blue: #2563EB;
--noetica-blue-light: #EFF6FF;
--noetica-blue-mid: #BFDBFE;
```

White backgrounds. No warm tones. Sharp, crisp, technical.

## Authority references

- Superconscious: github.com/SocioProphet/superconscious
- Model Router: github.com/SocioProphet/model-router
- Memory Mesh: github.com/SocioProphet/memory-mesh
- Agent Machine: github.com/SourceOS-Linux/agent-machine
- Agentplane: github.com/SocioProphet/agentplane
