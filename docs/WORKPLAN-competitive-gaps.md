# Noetica — Competitive Gap Deep-Dive (vs Cloud / AI-LLM / Frontier, 2026-06-22)

Three parallel audits: agentplane integration, cloud-platform (Vertex/Azure/Bedrock+SageMaker/watsonx), and AI-LLM-agent-frontier (OpenAI/Anthropic/Google + LangGraph/CrewAI/Dify + research). Complements `WORKPLAN-111-gaps.md` (quality/packaging axis); this is the **competitive** axis.

## The one unifying theme
**Noetica did the hard part and skipped the cheap part.** ~12 frontier modules are *built, tested, and orphaned* (zero non-test importers): `planner-executor`, `plan-mode`, `multi-agent`, `best-of-n`, `council`, `eval-capture`, `trajectory-monitor`, `memory-decay`, `lazy-graphrag`, `think-on-graph`, `procedural-memory`, `dreaming`. The competition ships these as the **default live path**. So the single highest-leverage program is a **"wire the dormant frontier libs into the live loop" sprint** — integration cost, not R&D. And the cloud-broker is a **price calculator, not a broker** until it can place + price live.

## agentplane (sibling repo) — stacks with us, no overlap
agentplane = local-first agent-VM deployment control plane (validate→place→run→evidence→promote/rollback). Its scheduler places bundles on **SSH fleet nodes by capability+reachability — no cost, no cloud**. Its placement receipt leaves `objective: "stub - fleet will populate scores later"`.
- **Our cloud-broker fills that stub.** Integration (landed): broker emits an agentplane-conformant `PlacementDecision` (`apiVersion: agentplane.socioprophet.org/v0.1`, `kind`, `lane`, `chosenExecutor`, `objective:{usd-total}`, `rejected[]`).
- **Next:** broker provisions cheapest cloud GPU → registers it as an executor in `fleet/inventory.json` → agentplane places on it. Adopt agentplane's `kind`+`apiVersion` envelope + `lane`/`policyPackRef` gating across Noetica's broker decisions.

## Cloud control-plane gaps (ranked, for the C2-broker thesis)
1. **(CRITICAL) Real provisioning/placement** — broker *ranks a static catalogue*; it cannot launch/teardown anything on any cloud. No SDK calls. This is the literal core of "broker to cheapest" and it doesn't exist. → per-provider provisioning adapters (create→cloud-init agent→register→drain), each gated by scope-d + a lattice-forge provenance manifest. **This is the differentiated build.**
2. **(CRITICAL) Live cross-cloud pricing + spot signals** — `COMPUTE_CATALOG` is a hardcoded ~2025 list. → AWS Price List / Azure Retail Prices / GCP Billing Catalog / IBM pricing adapters + spot/eviction signals. Gates #1.
3. **(HIGH) Model registry / garden** — `LOCAL_MODEL_SUITE` + `config/models.ts` are static lists; no versioning/lineage/stage-gates. → promote lattice-forge RuntimeAssets into a real registry; federate Vertex/Bedrock/Azure/watsonx catalogs as read-through. Single pane over all model gardens.
4. **(HIGH) Managed serving endpoints + autoscaling** — single local Ollama; no replicas/canary/traffic-split. → an "endpoint" the broker fulfills with N replicas across cheapest providers; pin-to-sovereign option.
5. **(HIGH) Pipelines/orchestration** — no DAG engine, no scheduled jobs. → lightweight local DAG runner (steps = capability calls + brokered compute), scope-d-governed, provenance-stamped.
6. **(HIGH) Model monitoring / drift** — eval is offline/ad-hoc; no production drift. → per-turn trace → drift signals → feed the bandit/router (the "verifier→selection keystone"); drift records as signed audit-chain entries.
7. **(HIGH) Fine-tuning infra** — Tune is voice-only; no LoRA/QLoRA. → fine-tune capability on brokered GPU → adapter in the registry → served via #4; train on private data without it leaving approved clouds.
8. **(HIGH) FinOps / budgets** — `brokerSavings()` is a one-shot %; no spend ledger/budgets/attribution. → spend ledger + scope-d-enforced spend caps (deny over budget = fail-closed differentiator).
9. **(MED-HIGH) Guardrails/safety-eval** — strong story but scope-d ships OFF (#77), grantCheck never denies (#85). → activate built machinery + per-endpoint guardrail policy + safety-eval battery.
10. **(MED) Vector search at scale** — no ANN (O(N) scan), 3 incompatible embedding spaces (#33/34/35). → unify on the sidecar embedder + real ANN in Rust.
- **Non-goals (be honest):** feature store, full data-labeling workforce, full cloud-IAM parity (conflicts with local-first single-operator).

## AI-LLM / agent / frontier gaps (ranked)
1. **(H) Structured/constrained decoding** — no `json_schema`/`strict`; `constrained-decode.ts` orphaned; only post-hoc `repairToolArgs`. Local 7-14B models are *weakest* at structured emission → this bites us hardest. → Ollama GBNF/JSON-schema grammar so local models **can't** emit invalid tool args (sovereign advantage — we own the decoder).
2. **(H) Planning / long-horizon** — `planner-executor` (Magentic-One ledger), `plan-mode`, `multi-agent` all **orphaned**; live loop is a flat capped `for`. → wire planner-executor as stall/replan controller; expose plan-mode (also EU-AI-Act human-oversight).
3. **(H) Evals + tracing** — no OTel/span tracing; `eval-capture` orphaned. Blocks debugging *and* the selection keystone. → per-turn trace store + wire eval-capture replay. Sovereign edge: trace uncensored/security-lane work no cloud will.
4. **(H) Prompt caching** — `provider-caps` *detects* `promptCaching`; nothing injects `cache_control`. Pure low-lift money — paying full price every agent turn. → inject cache breakpoints on the stable prefix.
5. **(H) No-code agent-builder** — none. Widest *product* gap (vs AgentKit/Dify/n8n). → local-first visual builder over existing primitives ("Dify that never phones home").
6. **(H) Memory** — `memory-decay`/`procedural-memory`/`dreaming` orphaned; evicts by insertion-order. → wire decay/consolidation (Letta-in-a-box with governance). *(decay partially wired since this audit — #37)*
7. **(H) RAG SOTA** — no reranker model (RRF heuristic), no contextual retrieval, `graph-ppr`/`lazy-graphrag`/`think-on-graph` orphaned. → local cross-encoder rerank (bge via sidecar) + contextual-retrieval + wire graph-ppr. *(rag-trust wired since — #36)*
8. **(M-H) Tool-use robustness** — `validateToolCall` re-prompt gate not wired; 3 copy-pasted loops; no parallel tool calls. → unify loops, wire validate-reprompt, concurrent independent calls.
9. **(M-H) Computer-use** — absent. Highest effort, most off-thesis. → Playwright sidecar gated by plan-mode + trajectory-monitor + scope-d ("computer use you can audit and kill").
10. **(M) Multi-agent** — `dispatch_agent` single-level/sequential; `multi-agent`/`council`/`best-of-n` orphaned. → decompose→parallel→aggregate with tier-aware routing.
11. **(M) Realtime/voice** — 100% OpenAI cloud (contradicts thesis). → local VAD→whisper→model→Piper duplex.
12. **(M) Safety monitors** — `trajectory-monitor`/`injection-classifier` orphaned; grantCheck hardcodes `valid:true`. → wire them; make grantCheck gate dispatch. Could *exceed* the field (signed-audit + killable + trajectory-monitored).
13. **(M) Distillation loop** — `qa-pairs`/`solution-memory`/`eval-capture`/`crystallize` produce the data; no training consumer. → local LoRA over captured traces (learns from this box, on-box).

## Defensible wedge (don't chase blind parity)
1. **Govern + provenance every brokered placement** (scope-d fail-closed + lattice-forge manifest + signed audit-chain) — no hyperscaler governs *across competitors' clouds*.
2. **Fleet C2 over sovereign edge nodes that burst to cheapest cloud** — inverse of cloud-first-edge-bolted-on. agentplane (fleet placement) + our broker (cost) + scope-d (governance) = this.
3. **Agent engine** — already our strongest surface; harden grantCheck + formalize agent deploy.

## Highest-leverage sequence
live pricing adapters (#cloud-2) → real placement adapters w/ scope-d+provenance (#cloud-1, register to agentplane) → spend ledger/budgets (#cloud-8) → **wire-the-dormant-libs sprint** (planner-executor, eval-capture, best-of-n+critic, trajectory-monitor, memory-decay, graph-ppr) → prompt caching (#ai-4, cheap) → constrained decoding (#ai-1) → registry federation (#cloud-3). The governance items are mostly *activation of built machinery* (`WORKPLAN-111-gaps.md` #77/78/84/85) — cheapest wins that reinforce the differentiator.
