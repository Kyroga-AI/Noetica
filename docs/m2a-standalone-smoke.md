# M2a Standalone Smoke

This smoke test verifies the M2a live standalone provider path without requiring SourceOS or Neuronpedia.

## Preconditions

Run the app with live provider keys configured:

- `OPENAI_API_KEY` for OpenAI models.
- `ANTHROPIC_API_KEY` for Anthropic models.

Optional provider model overrides are available when provider aliases move:

- `OPENAI_MODEL_ID`
- `ANTHROPIC_MODEL_ID`

`NEURONPEDIA_API_KEY` is not required for M2a.

## Run

Terminal 1:

```bash
npm install && npm run dev
```

Terminal 2 — OpenAI:

```bash
SMOKE_MODEL_ID=gpt-4o npm run smoke:standalone
```

Terminal 2 — Anthropic:

```bash
SMOKE_MODEL_ID=claude-sonnet-4-6 npm run smoke:standalone
```

If the provider model alias has moved, set the corresponding runtime override while selecting the UI-facing model:

```bash
ANTHROPIC_MODEL_ID=<current-provider-model-id> SMOKE_MODEL_ID=claude-sonnet-4-6 npm run smoke:standalone
OPENAI_MODEL_ID=<current-provider-model-id> SMOKE_MODEL_ID=gpt-4o npm run smoke:standalone
```

## Pass condition

The script exits `0` and prints JSON containing:

- `ok: true`
- `model_routed`
- `provider`
- positive `latency_ms`
- 64-character `request_hash`
- 64-character `evidence_hash`
- at least one streamed delta
- a non-empty response preview

`request_hash` and `evidence_hash` must both be present and must not be equal. If they are equal, the response was not included in the evidence commitment and the smoke must fail review even if the script exits successfully.

## Required M2a acceptance record

M2a is not complete until this section contains real output from both provider paths.

### OpenAI smoke record

Status: `PENDING`

```json
{
  "ok": true,
  "baseUrl": "",
  "model_id_requested": "gpt-4o",
  "model_routed": "",
  "provider": "openai",
  "latency_ms": 0,
  "request_hash": "",
  "evidence_hash": "",
  "deltas": 0,
  "content_preview": ""
}
```

Reviewer checklist:

- [ ] Live `OPENAI_API_KEY` was configured.
- [ ] Response streamed with at least one delta.
- [ ] `latency_ms` is positive and covers request-to-final-token time.
- [ ] `request_hash` is 64 lowercase hex characters.
- [ ] `evidence_hash` is 64 lowercase hex characters.
- [ ] `request_hash != evidence_hash`.
- [ ] Governance trail renders provider, routed model, latency, request hash, and evidence hash.

### Anthropic smoke record

Status: `PENDING`

```json
{
  "ok": true,
  "baseUrl": "",
  "model_id_requested": "claude-sonnet-4-6",
  "model_routed": "",
  "provider": "anthropic",
  "latency_ms": 0,
  "request_hash": "",
  "evidence_hash": "",
  "deltas": 0,
  "content_preview": ""
}
```

Reviewer checklist:

- [ ] Live `ANTHROPIC_API_KEY` was configured.
- [ ] Response streamed with at least one delta.
- [ ] `latency_ms` is positive and covers request-to-final-token time.
- [ ] `request_hash` is 64 lowercase hex characters.
- [ ] `evidence_hash` is 64 lowercase hex characters.
- [ ] `request_hash != evidence_hash`.
- [ ] Governance trail renders provider, routed model, latency, request hash, and evidence hash.

## Steering-tier UI smoke

Before merge, verify the three model capability states do not produce broken UI:

- [ ] `full`: selecting GPT-2 Small / Neuronpedia renders the SAE panel and missing key state cleanly.
- [ ] `local`: selecting Llama renders local-inference-required state cleanly in standalone mode.
- [ ] `none`: selecting Claude or GPT-4o renders provenance/tamper-evidence posture, not SAE controls.

## API rejection smoke

Before merge, verify impossible steering requests fail cleanly:

- [ ] `steering` params sent to a `none` model return a clean `model_not_steering_capable` error.
- [ ] `steering` params sent to a `local` model in standalone mode return a clean `local_steering_requires_sourceos` error.

## Boundary

This smoke verifies standalone provider streaming and local Noetica tamper-evidence. It does not verify real SAE steering, SourceOS routing, memory-mesh persistence, or agentplane evidence persistence.
