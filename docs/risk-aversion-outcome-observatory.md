# Risk Aversion Outcome Observatory

Noetica measures how an AI interaction changes as risk pressure accumulates across turns.

This is not hidden-neuron analysis for closed hosted models. It is behavioral evidence analysis: user framing, risk pressure, observed steering mode, deflection delta, and outcome impact.

## Core equation

```text
input turn -> risk vector -> steering / response mode -> deflection delta -> outcome card
```

## Why this exists

AI systems do not only answer the user's topic. They also manage perceived risk. When a conversation moves from technical observation into culpability, attribution, cybercrime, legal exposure, or public evidence packaging, the response can shift.

That shift can be appropriate. It can reduce unsupported claims.

It can also distort an investigation. It can slow down direct analysis, soften language, avoid attribution, increase evidence demands, or reframe the user's request into a safer model.

Noetica records that transition.

## First implementation

The first slice is deterministic and local:

- `lib/risk/riskAversion.ts` defines the contracts.
- `lib/risk/riskAversionScorer.mjs` scores a turn or corpus.
- `lib/risk/riskAversionRuntime.ts` builds a runtime `TurnRiskTrace` from completed chat interactions.
- `lib/risk/riskAversionArtifact.ts` writes runtime risk traces as bounded local artifacts.
- `lib/risk/riskAversionLive.ts` derives a live UI readout from current chat messages.
- `lib/risk/riskAversionDemo.ts` provides fixture-backed fallback readout data.
- `scripts/score-risk-aversion.mjs` exposes scoring through npm.
- `scripts/validate-risk-aversion-fixtures.mjs` validates accepted/rejected fixtures.
- `scripts/validate-counterfactual-risk-replay.mjs` validates counterfactual replay ordering.
- `scripts/validate-sourceos-risk-observatory-refs.mjs` validates SourceOS fixture refs into risk-observatory evidence.
- `scripts/generate-risk-aversion-graph.mjs` exports graph and matrix artifacts.
- `scripts/generate-counterfactual-risk-report.mjs` exports counterfactual replay reports.
- `scripts/export-risk-aversion-traces.mjs` exports bounded risk traces and a manifest.
- `scripts/risk-aversion-export-path.mjs` resolves development and production trace export paths.
- `examples/risk-aversion/` contains bounded corpus and counterfactual replay fixtures.
- `lib/sourceos/interaction.ts` attaches runtime risk trace refs to standalone SourceOS interaction events.
- `lib/sourceos/interactionEvent.ts` can attach a bounded `riskAversionTrace` to exported `SourceOSInteractionEvent` payloads.
- `components/risk/RiskAversionPanel.tsx` renders the live or fallback readout in the Noetica side panel.

## Commands

Score a corpus fixture:

```bash
npm run risk:score -- --file examples/risk-aversion/chatgpt-crash-corpus.accepted.json
```

Validate fixtures:

```bash
npm run risk:validate-fixtures
```

Validate counterfactual replay ordering:

```bash
npm run risk:validate-counterfactual
```

Generate counterfactual replay report artifacts:

```bash
npm run risk:counterfactual:report -- --file examples/risk-aversion/counterfactual-replay.accepted.json --out-dir .noetica/risk-aversion/counterfactual
```

Validate SourceOS risk-observatory refs:

```bash
npm run sourceos:events:risk-refs:check
```

Generate local graph artifacts:

```bash
npm run risk:graph -- --file examples/risk-aversion/chatgpt-crash-corpus.accepted.json --out-dir .noetica/risk-aversion
```

Export bounded risk traces:

```bash
npm run risk:export -- --file examples/risk-aversion/chatgpt-crash-corpus.accepted.json
```

Show the risk-trace export path:

```bash
npm run risk:path
```

The graph command emits:

- `risk-aversion-graph.json`
- `risk-aversion-graph.dot`
- `risk-aversion-graph.mmd`
- `risk-aversion-matrix.json`
- `risk-aversion-matrix.csv`

The counterfactual report command emits:

- `counterfactual-risk-report.json`
- `counterfactual-risk-report.csv`
- `counterfactual-risk-report.mmd`
- `counterfactual-risk-report.dot`

The trace export command emits:

- one `*.risk-trace.json` file per scored turn;
- `risk-aversion-export-manifest.json`;
- per-trace SHA-256 hashes;
- local `urn:noetica:risk-trace:*` refs.

## Counterfactual replay

Counterfactual replay holds the technical substrate constant while changing the user frame.

The first fixture validates this ordering:

```text
neutral -> forensic -> culpability -> attribution
```

The validator scores each variant and enforces non-decreasing aggregate risk pressure. It also checks that the culpability variant separates proof from hypothesis and the attribution variant avoids direct attribution.

The report generator converts the replay fixture into JSON, CSV, Mermaid, and DOT artifacts. The report includes each variant's aggregate risk score, caution delta, attribution-suppression delta, hypothesis-reframing delta, observed steering modes, and outcome impact.

## Live UI readout

The Noetica shell derives a live risk-aversion readout from the current `ChatMessage[]` state:

```text
messages -> latest user/assistant pair -> risk dimensions -> aggregate score -> steering modes -> outcome label
```

The right-side Outcome Observatory card displays:

- source: `live` or `fallback`;
- latest turn label;
- aggregate risk-aversion pressure;
- dominant risk dimensions;
- observed steering modes;
- directness delta;
- caution delta.

If no user/assistant pair exists yet, the card falls back to the bounded fixture-backed readout.

## Runtime trace persistence

For standalone provider completions, the chat API now builds a runtime `TurnRiskTrace` after the provider response completes.

The runtime path is best-effort and bounded:

```text
completed response -> runtime risk trace -> local artifact write -> SourceOS interaction event refs
```

The default runtime artifact path is:

```text
.noetica/risk-aversion/runtime-traces
```

Override with:

```text
NOETICA_RUNTIME_RISK_TRACE_DIR
```

The completed SourceOS interaction event receives:

- `payload.outcomeObservatoryRef`
- `payload.riskAssessmentVersion`
- `payload.riskAversionTraceRef`
- `payload.riskAversionTracePath`
- `payload.riskAversionTraceHash`
- `steeringIntent.featureRef`
- `steeringIntent.strength`
- `governanceTrace.evidenceRefs`
- `sourceEventRefs`

Failure to write the local artifact does not fail the provider completion. In that case, the event still carries the local risk-trace URN and aggregate score, but the artifact path/hash remain null.

## SourceOS interaction payload bridge

The SourceOS interaction schema already permits bounded `payload` records. Noetica now attaches risk evidence without editing the pinned generated SourceOS type.

When a `TurnRiskTrace` is supplied to `buildNoeticaChatCompletionInteractionEvent`, the event payload includes:

- `outcomeObservatoryRef`
- `riskAversionTrace`
- `riskAssessmentVersion`

The same risk score also maps to `steeringIntent.strength`, and the turn trace maps to `steeringIntent.featureRef` as a local Noetica risk-trace URN.

The fixture validator enforces that SourceOS interaction artifacts keep these refs consistent across:

- payload risk trace refs;
- `steeringIntent.featureRef`;
- `governanceTrace.evidenceRefs`;
- `governanceTrace.replayRef`;
- `sourceEventRefs`.

## Risk dimensions

The first scorer tracks:

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

## Steering modes

The first scorer detects observable response modes:

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

## Interpretation discipline

Use this language:

- observed risk-aversion pressure;
- observed steering or response-mode transition;
- observed deflection delta;
- supported gate hypothesis;
- counterfactual replay required.

Avoid this language unless direct evidence exists:

- hidden neuron activation in a closed hosted model;
- proven intent;
- proven party culpability;
- direct access to provider-side policy or routing state.

## Next implementation slices

1. Add a CI workflow lane when the repository workflow surface is present.
2. Add a runtime UI affordance for exported risk trace refs and hashes.
