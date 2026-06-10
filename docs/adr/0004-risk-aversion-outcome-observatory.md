# ADR-0004 — Risk Aversion Outcome Observatory

## Status

Accepted.

## Context

Noetica needs a disciplined way to show how AI interactions change as legal, attribution, security, evidentiary, and reputational pressure accumulates across turns.

The product should not claim direct access to hidden activations for closed hosted models. For closed models, Noetica can measure observable behavior: the user frame, risk pressure, assistant response mode, deflection delta, evidence requests, attribution avoidance, hazard-model reframing, and artifact production.

For open or white-box models, Noetica may later attach direct activation, SAE feature, or circuit-tracing evidence. That is out of scope for this first slice.

## Decision

Add a bounded, deterministic risk-aversion outcome layer to Noetica.

The first implementation is artifact-first and local. It introduces:

- turn-level risk-aversion contracts;
- a deterministic keyword/structure-based scorer;
- accepted and rejected corpus fixtures;
- a fixture validator;
- npm scripts for scoring and validation.

Noetica remains the operator surface and artifact exporter. It does not become the durable cross-estate event authority.

## Model

Each turn is modeled as:

```text
input turn -> risk vector -> steering / response mode -> deflection delta -> outcome card
```

Risk-aversion dimensions include:

- liability risk;
- attribution risk;
- defamation risk;
- privacy risk;
- platform-abuse risk;
- reputational risk;
- evidence-quality risk;
- medical/legal/financial risk;
- self-harm or violence risk;
- security-misuse risk;
- model-uncertainty risk.

Observable steering modes include:

- direct answer;
- qualify causality;
- request more evidence;
- avoid attribution;
- separate proof from hypothesis;
- shift to hazard model;
- refuse or boundary;
- artifact production;
- counterfactual replay;
- safe redirect.

## Non-goals

- No hidden-neuron claims for closed hosted models.
- No party-culpability adjudication.
- No durable event-store authority.
- No live SourceOS append path.
- No model-call classifier in the first slice.

## Consequences

This gives Noetica a reproducible baseline for showing risk-aversion pressure and steering/deflection behavior across a rolling corpus. It also creates a stable contract for future UI cards, graph generation, SourceOS interaction event payloads, and counterfactual replay.
