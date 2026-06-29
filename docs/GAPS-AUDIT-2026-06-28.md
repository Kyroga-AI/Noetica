# Gaps & Improvements Audit — 2026-06-28

Synthesis of the seven current survey/strategy docs (Workspace/one audit + scoreboard + gap-analysis,
AI_STACK_COMPARISON, HYPERSCALER_STRATEGY, WORLD-CLASS-ROADMAP, WORKPLAN-competitive-gaps) cross-checked against
the live code, plus what moved this session. Supersedes the scattered gap lists as the single read.

## 1. The converged thesis (unchanged, now sharper)

**We built the hard part and skipped wiring the cheap wins.** Every audit lands here independently:
- The AI-stack review: "built/tested/orphaned with zero live importers… wire the dormant frontier libs."
- The roadmap: signals computed but "not gated"; best-of-N "off by default"; learning loop "never reaches weights."
- The cloud thesis: the broker "provisions nothing yet — it's a cost calculator… 'routes to cheapest' is advice, not action."
- Workspace: only **two** moats survive scrutiny — *unlinkable identity* and *ontology-governed sharing/graph-native knowledge*. Sovereignty alone is table stakes (Proton/Nextcloud).

The binding constraint is not capability, it's **proof + activation**: almost everything is test-green in isolation, not run on metal or wired into the live loop.

## 2. Gap ledger (deduped, ranked by leverage)

| # | Gap | Severity | Source | Status (2026-06-28) |
|---|-----|----------|--------|---------------------|
| 1 | **Verifier→selection loop** not closed (signals exist, no unified accept/escalate gate; best-of-N off) | 🔴 highest | roadmap #1 | Open — "mostly wiring" |
| 2 | **Fine-tuning trainer** was a scaffold (`_run_with_ray`→local; `/api/tune` stub) | 🔴 keystone | AI-stack, roadmap #7, workplan | **Advanced this session** → real Ray Train LoRA trainer authored + tested; needs metal to run |
| 3 | **Cloud broker provisions nothing** — static catalog, no SDK create/teardown | 🔴 critical | workplan cloud-1/2 | Open — per-provider adapters + live pricing |
| 4 | **No proof on metal** — WS-A/WS-C never run on real GPU/Ray | 🔴 binding | handoff, AI-stack #3 | **De-risked this session** → cost tee-up done: ~$123 one-off to prove the whole story |
| 5 | **Governance not "printable"** — no SOC2/ISO-42001 certs, no benchmarked guard model | 🟠 sales-gating | AI-stack | Open — reports exist (`compliance-report.ts`), certs/benchmark don't |
| 6 | **Graph-native knowledge layer** (the Notion leapfrog) not shipped as product | 🟠 moat | WS audit #3, scoreboard #6 | Partial — libs built (`knowledge-graph.ts`), UI demo-grade |
| 7 | **Unified identity / SSO** — 3 identity stores; IdP not deployed | 🟠 #1 WS gap | WS gap-analysis #1 | Partial — broker + OIDC built; deploy P0s open |
| 8 | **Constrained decoding** (GBNF/json-schema) unused; post-hoc repair only | 🟠 cheap+high | workplan ai-1, roadmap | Open — "kills malformed tool calls at the source" |
| 9 | **Dormant frontier libs** (planner-executor, eval-capture, trajectory-monitor, graph-ppr, memory-decay) | 🟠 | workplan | Partial — decay/rag-trust wired since; rest orphaned |
| 10 | **Prompt caching** detected but never injected (`cache_control`) | 🟡 free money | workplan ai-4 | Open — pure low-lift cost win |
| 11 | **Mail-API bridge / Dovecot adapter** — demo store, not real IMAP | 🟡 cutover-gate | WS scoreboard P0 | Partial — `mail-bridge.ts` built, demo store |
| 12 | **Python dep hygiene** — hard deps undeclared (sympy/numpy/sklearn…) | 🟡 fragility | this session | **Closed this session** → requirements declared |
| 13 | **Multi-agent orchestration** thin; council/best-of-n orphaned | 🟡 | AI-stack, workplan | Open |
| 14 | **Cognitive-services breadth** (vision/translate/doc-AI) — macOS-OCR-only | 🟡 | AI-stack | Open — broker, don't build |

## 3. What this session changed

- **#2 Fine-tuning trainer (keystone)** — replaced the `_run_with_ray` placeholder with a real implementation:
  `slate/trainers/causal_lm_lora.py` (HF PEFT LoRA/QLoRA SFT loop) + `atlas/ray_train_lora.py` (Ray Train
  `TorchTrainer`, scaling config derived from the brokered placement) + graceful local fallback that records
  *why* it fell back. Pure logic unit-tested (targets/config/formatting/scaling) without GPU. Deps declared
  (`requirements-train.txt`). **Still needs a Ray/GPU env to execute** — but it is no longer a scaffold.
- **#4 Proof-on-metal cost** — produced the WS-A/WS-C run-cost tee-up (`docs/WS-A-WS-C-COST-TEEUP.md`, generated
  by `agent-machine/scripts/cost-teeup.ts` off the canonical catalog): **~$123 one-off** (WS-A fine-tunes $90 +
  WS-C bursts $33) + ~$400/mo only if the 24/7 serve baseline runs. The metal proof is now a coffee-budget decision.
- **#12 Dep hygiene** — declared sympy/numpy/scipy/scikit-learn/pypdf/jsonschema/gplearn for agent-machine; this
  was the real cause of the "blocked push" (the pre-push test gate failed on undeclared sympy).

## 4. Recommendation (sequenced)

**Now (no new infra):**
1. **Close the verifier→selection loop (#1)** — the single highest-leverage, mostly-wiring change: fuse the
   existing {value-judgment, pln-judgment, complexity, grounding, code test-pass} signals into one
   accept/escalate/clarify gate, and turn best-of-N on by default with that gate as selector.
2. **Prompt caching (#10) + constrained decoding (#8)** — cheap, compounding wins; #8 disproportionately helps the
   local 7–14B models that are weakest at structured emission (a sovereign advantage: we own the decoder).

**Next (one GPU box, ~$123 + a Ray cluster):**
3. **Run WS-A on metal** — execute the new trainer end-to-end on a brokered Nebius H100 (the tee-up prices it at
   $18 for a Qwen LoRA). This converts the keystone from "authored" to "proven" and unlocks the compounding loop
   (#2 → learning-loop-into-weights).
4. **WS-C live proof** — the "beats-frontier-on-your-tests, flat cost" burst ($9–33). This is the client wedge.

**Then (sellable):**
5. **One provisioning adapter (#3)** — pick the cheapest broker target (Nebius) and make create→register→drain
   real for that one provider; "routes to cheapest" becomes action, not advice.
6. **Governance evidence (#5)** — wire `compliance-report` to real scope-d Event-IR + a public groundedness
   benchmark; start the SOC 2 path. Don't claim certs we don't hold.

**Don't:** rebuild the office suite, chase frontier-model ownership, or build cognitive services — broker those.
Defend the two real moats (unlinkable identity, graph-native governed knowledge) and prove the cloud-mesh economics.

---
*Method note: every claim here is grounded in a named survey doc or verified in code this session. Benchmarks in
`model-registry.ts` remain representative (~Jan-2026) — re-verify before client use.*
