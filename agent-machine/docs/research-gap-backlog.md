# Research → Product Gap Backlog (the loop)

**The loop (operating mode):** investigate gaps → survey labs/papers/competitors → prioritize gaps →
implement → measure → **repeat**. Each pass adds rows here, ships the top ones, re-surveys.

## Banked wins
- 🏆 **Council champion = 71.7%** — top arm on qwen2.5:7b (baseline 69.2, brain 70.0). Integration is sound.
- ✅ **Self-consistency** (`askVote`) — Google 2022. In production (the council vote).
- ✅ **VSA / NVSA substrate** (`vsa.py`) — IBM Nature MI 2023. HRR bind/unbind/bundle/permute + cleanup, validated. The vector↔symbolic bridge.

## In flight (GPU)
- 🔄 **Track A** — definitive board (`baseline·brain·champion·gate·autoform`, 7 lanes, n=30, 432K brain). → does it clear 74.2%?
- 🔄 **Track B** — concept-extraction glossary over all 7 fields (GLiNER on T4).

## Backlog — prioritized (lab · paper · what it gives us · status)

| P | Gap | Lab · paper | Gives us | Status |
|---|-----|-------------|----------|--------|
| **0** | **Medprompt** (choice-shuffle ensemble + dynamic kNN few-shot + self-CoT) | **Microsoft** 2023 | **90.10% MMLU via PROMPTING** (highest ever); choice-shuffle is the *principled* A-bias cure; kNN few-shot = CBR exemplars from our brain | **next — the MMLU recipe** |
| 1 | **Phi-style distillation** — curate textbook-quality data from OCW → fine-tune/distill small model | **Microsoft** Phi | 2.7B beats 25× larger on reasoning; turns our corpus into model weights | research |
| 1 | **Contextual Retrieval — hybrid BM25 + RRF** | Anthropic 2024 | catches exact-term matches dense misses | ✅ `MMLU_HYBRID` (full contextual-embeddings re-embed = GPU upgrade) |
| **0** | **Medprompt choice-shuffle ensemble** | Microsoft | rotations cancel position bias → the A-bias cure | ✅ `medprompt` arm (`MMLU_SHUFFLE`) |
| 1 | **Distill technique → weights** (council/Medprompt trajectories → SFT/distill small model) | **DeepSeek-R1** (GRPO, 800K trajectories) + **Thinking Machines** on-policy distill | turn inference-technique into a small model that IS the technique — the endgame of "technique not horsepower" | research (the big one) |
| 1 | **RLVR post-training** (SFT→DPO→RLVR with verifiable MMLU-correctness reward) | **AI2 Tülu 3 / OLMo 2** | fully-open recipe to fine-tune our model with answer-correctness rewards | research |
| 2 | **Cross-encoder reranker** | **Cohere Rerank 4** (Dec'25) | upgrade our BM25/RRF hybrid with a real reranker | backlog |
| 2 | **Optimal test-time compute allocation** | **NeurIPS'24** Snell ("test-time compute > params") + Adaptive-SC | spend samples where they matter (easy Q → 1, hard → many) — the academic backing for our whole thesis | backlog |
| 3 | **RankRAG** (rank context + generate in one LLM) | NeurIPS'24 | unify rerank+answer | backlog |
| 2 | **AlphaEvolve** evolutionary combiner discovery | **DeepMind** 2025 | LLM proposes combiner-program variants + evaluator + evolution → discover the council law (FunSearch successor; beat Strassen) | upgrade meta_combiner |
| 2 | **On-policy distillation** — distill the council into model weights | **Thinking Machines** 2025 | technique → weights (the small model internalizes council reasoning) | research |
| 3 | **Deterministic/batch-invariant inference** | **Thinking Machines** 2025 | reproducible benchmark numbers (clean-eval/`batch_invariant_ops`) | research |
| 3 | **Training-free routing (SkewRoute) + RAG reward model (RAGferee)** | **Amazon** EMNLP'25 | route by retrieval-score skewness (cheaper gate); reward model for retrieval quality | backlog |
| 1 | **VSA problem-manipulation** (concept compose, CBR structure-match, abductive MCQ) | IBM NVSA | manipulate problems algebraically in vector space | substrate built → apply |
| 2 | **CISC** (confidence-weighted SC) | Google 2025 | 40% fewer samples, +acc on the council vote | ✅ `MMLU_CISC` |
| 2 | **Self-Discover routing** | DeepMind NeurIPS'24 | learned per-type reasoning structure (replaces hand-coded knowledge_type) | backlog |
| 2 | **Least-to-Most decomposition** | Google | subproblem decomposition for math/compositional lanes | backlog |
| 2 | **Gödel-abstraction arm** | (ours + abstraction lit) | lift problem to its canonical form, solve the form | backlog |
| 3 | **FunSearch combiner** | DeepMind Nature'23 | LLM-proposes-programs + evaluator → discover the council law (upgrade gplearn) | backlog |
| 3 | **CBR / analogical** | C²P 2024 | retrieve structurally-similar SOLVED problem, transfer reasoning | backlog |
| 3 | **Process-supervision verifier (PRM)** | OpenAI 2023 | step-level (not outcome) scoring — replaces failed elim | backlog |
| 3 | **Tree-of-Thoughts search** | Princeton/DeepMind | deliberate search+backtrack for hard lanes (Game-of-24 4%→74%) | backlog |
| 4 | **HippoRAG concept graph + PPR** | OSU NeurIPS'24 | graph retrieval; blocked on extractor speed (Track B unblocks) | infra built |
| 4 | **RAPTOR summaries** | Stanford ICLR'24 | hierarchical summary nodes; fixes 6/8 redundancy | subagent |
| 4 | **Entity-linking glossary v2** | Meta GENRE/BLINK + SciSpacy UMLS | canonical IDs (Wikidata/UMLS/MeSH/MSC) — dedup+interop moat | backlog |
| 5 | **Joint retriever-LM** | Meta Atlas | train retriever with LM (we use frozen) — the thesis anchor | research |
| 5 | **Autoform NL→formal + checker-as-reward** | DeepMind AlphaProof | strengthen the compute spine | partial (autoform abstains) |
| 5 | **LNN neurosymbolic operations layer** | IBM LNN/NSQA | NL→logical form → reason over KB | research |

## Retired
- ❌ **elim** (Monty-Hall per-choice) — 45%, below random on stats. Outcome-level verify fails; PRM is the fix.

## Loop cadence
After each implement+measure pass: append new gaps, re-rank, re-survey for what the field shipped since. Keep `[[project_mmlu_championship]]` memory + this file in sync.

## Fresh deepdive (iter 5 — "stop using memory") — NEW, beyond prior backlog

| P | Gap (genuinely new) | Lab/paper | Status |
|---|---|---|---|
| **0** | **RAFT** — fine-tune on golden+DISTRACTOR docs so the model learns to use retrieval / ignore noise (our #1 failure, in weights) | UC Berkeley 2403.10131 | ✅ wired into `distill_prep` (RAFT context); fine-tune = GPU step |
| **0** | **Qwen3-Embedding-8B** swap (we ran outdated `nomic`!) — broad retrieval lift, ~free | Alibaba (70.58 MTEB) | env-ready (`NOETICA_EMBED_MODEL`); **re-embed = GPU job, queue** |
| 1 | **Qwen3-Reranker** (open cross-encoder) | Alibaba 2601.04720 | queue (rerank step on hybrid candidates) |
| 1 | **Search-R1 / R1-Searcher** — RL-train the model to interleave reason+search (token-masked) | 2503.09516 | research (RL) |
| 2 | **HippoRAG2** — proven upgrade to our lite HippoRAG (passage integration, seed/reset tuning) | Gutiérrez 2025 | upgrade hippo_graph |
| 2 | **ReasoningBank** — agent accumulates reasoning memory + self-evolves | 2509.25140 | connects to our evidence-fabric (revive) |
| 3 | **Coconut** — latent (continuous-thought) reasoning, BFS over paths, fewer tokens | Meta 2412.06769 | research |
| 3 | **LightRAG / KAG / LinearRAG** — lighter/linear graph-RAG alternatives | EMNLP'25 / 2409.13731 | eval vs our graph |
| 3 | **EAGLE-3 speculative decoding** — 1.4× faster inference (our cost/speed pain) | 2026 | infra |

**Deepdive takeaway:** the field's real leverage moved to (1) a CURRENT embedder+reranker (we're on an old one — cheapest fix), (2) TRAINING the model to use RAG (RAFT) rather than coaxing it at inference. Both now actioned (RAFT wired; embedder one re-embed away).

## Fresh deepdive (iter 6, 2026-06-22 — 3 parallel web survey agents, NOT from memory) + TOP 25

**Honest verdict — is our stack ahead of / level with / behind peers?**
- **Orchestration breadth: AHEAD/level.** council·CISC·hybrid(BM25/RRF)·MMR·CRAG·HippoRAG-lite·VSA·qgen(HyDE/step-back)·verified-compute(sympy)·glossary + the evidence-fabric moat is a genuinely strong, on-trend technique stack.
- **Raw capability: BEHIND, ~1–1.5 generations.** Three concrete weak links the survey nailed: (a) **qwen2.5:7b is a generation behind** — a 4B *thinking* model (Qwen3-4B-Thinking-2507) scores **74.0 MMLU-Pro** vs our base ~56; (b) **dated embedder** (nomic — superseded by EmbeddingGemma/Granite-R2/ReasonEmbed); (c) **no reranker at all** (the field's table stakes, now reasoning-based). And the biggest lever — **reasoning distillation (technique→weights)** — is PREPPED (RAFT/STaR) but **not executed**. "Shipped" in 2026 means weights, not just an inference graph.
- **Honest target:** technique + a current backbone realistically reaches **high-70s to low-80s MMLU-Pro** (near 2024-frontier knowledge on a 7B). Frontier closed models (~90 MMLU-Pro / ~88 GPQA-Diamond) stay ~10–15 pts beyond any 7B. The "technique not horsepower" thesis HOLDS (rStar-Math: a 7B rivaling o1 on math, no bigger teacher) but the backbone is now the weak link, not the thesis.

**TOP 25 MOVES (merged + ranked; ✅=done this loop):**
| # | Move | Source (lab · arXiv/date) | Gives us | Effort |
|---|------|---------------------------|----------|--------|
| 1 | **Backbone → Qwen3-4B-Thinking-2507 / Qwen3-8B** (enable_thinking dial now wired) | Alibaba 2505.09388 | 74.0 MMLU-Pro off the shelf; cheapest single jump | low |
| 2 | **Execute On-Policy Distillation** on our RAFT/STaR data (adaptive fwd/rev-KL) | Thinking Machines 2025-10 + 2603.07079/2604.00626 | +15–25 MMLU-Pro; technique→WEIGHTS (the endgame) | med/high |
| 3 | **Add a reasoning reranker — E²Rank (embedder doubles as reranker)** or ReasonRank | Renmin/Alibaba 2510.22733 · 2508.07050 | the missing table-stakes stage; free from our embedder | med |
| 4 | **Replace nomic → EmbeddingGemma-308M** (on-device, Matryoshka) or **ReasonEmbed/ReasonIR** | Google 2025-09 · 2510.08252 · Meta/MIT 2504.20595 | +6.4% MMLU (reasoning retriever); shrinks 432K index | low/med (re-embed=GPU) |
| 5 | **DeepConf** — confidence early-stop + conf-weighted vote (CISC successor) | Meta FAIR 2508.15260 | −84% tokens, top-tier acc; upgrades our council vote | low |
| 6 | **Adaptive sampling controller — ReASC/Seer/CGES** (per-Q sample budget) | 2601.02970 · 2511.09345 · 2511.02603 | difficulty-adaptive compute (we run fixed-N) | low/med |
| 7 | **SymCode** — LLM→SymPy→sandbox pass/fail + self-debug (generalize our CAS arm) | 2510.25975 | hard symbolic verifier w/ error-feedback repair | low/med |
| 8 | **ThinkPRM** — generative step-verifier from ~1K CoTs (replace reflect/PRM-lite) | TMLR 2504.16828 | real process verifier, data-cheap; beats LLM-judge +7.2% | med |
| 9 | **PRIME** — process rewards from OUTCOME labels only (MMLU gives this free) | 2502.01456 | dense process reward w/o step labels | med |
| 10 | **Late Chunking** — embed doc then chunk (training-free context preservation) | Jina 2409.04701 | cheap index-side fix to our 432K chunk context-loss | low |
| 11 | **DIVER-style iterative reasoning query-expansion** (beyond HyDE/step-back) | 2508.07995 (BRIGHT SOTA) | better query-gen | med |
| 12 | **Adopt BRIGHT eval** (reasoning-intensive retrieval) alongside MMLU | 2407.12883 | the right lens for our reasoning-retrieval goal | low |
| 13 | **GenPRM** — generative PRM w/ per-step CODE verification (neurosymbolic verifier) | 2504.00891 | 7B>72B-PRM on ProcessBench; fuses sympy into the reward | med/high |
| 14 | **rStar-Math** — small-LLM MCTS + process-preference model, self-evolved | ICML 2501.04519 | the flagship "technique-not-horsepower" blueprint | high |
| 15 | **Atom of Thoughts** — Markov atomic decomposition (under our ToT/L2M) | NeurIPS 2502.12018 | budget-limited reasoning focus | med |
| 16 | **AdaQR / reasoner-router in embedding space** (cheap dense reasoning, route hard→LLM) | 2510.21727 | −28% reasoning cost; pairs with CRAG gate | med/high |
| 17 | **DEDUP: bench imports `study-brain` loader** (kill the duplicate OCW loader) | audit | finish the extraction (bench still has inline copy) | low |
| 18 | **DEDUP: unify embedder** (study-brain `ollama.embedText` ↔ graph `embedBatchLocal`) | audit | one embedding entry point | low |
| 19 | **DEDUP: collapse 3–4 RRF/BM25 impls → one `rerank-rrf` primitive** | audit | kill triplication before wave-3 merges | low/med |
| 20 | **DOUBLE-DIP: ✅ OCW brain → UI GraphRAG community reports** (PR #86) | audit | UI graph "knows" MIT-OCW | ✅ done |
| 21 | **DOUBLE-DIP: HippoRAG `associativeRetrieve` as a study-brain expansion arm** | audit | multi-hop for the flat-cosine study-brain | med |
| 22 | **DOUBLE-DIP: `semanticEntropy` (uncertainty.ts) into the council vote** | audit | principled abstain vs raw agreement count | low/med |
| 23 | **CONVERGE: one `lib/knowledge-retrieve.ts`** (dense+HippoRAG+rerank, one embedder) | audit | the shared retrieval surface for lanes+bench+UI graph | med |
| 24 | **GRPO corrections — Dr.GRPO (length-bias, near-free) + DAPO clip-higher + KL-Cov** | 2503.20783 · 2503.14476 · 2505.22617 | stop entropy-collapse/CoT-pathology in any RLVR | low→high |
| 25 | **Soft Thinking** — training-free latent reasoning over concept-token distribution | 2505.15778 | deployable latent-reasoning extension of our VSA | med |

**Backlog corrections (the loop caught our staleness):** "DeepSeek-R1 GRPO" → now GRPO + Dr.GRPO + DAPO + KL-Cov (the 2025 anti-collapse fixes). "Snell test-time-compute" → superseded by adaptive per-Q controllers (DeepConf/ReASC/Seer) + "Art of Scaling TTC" taxonomy (2512.02008: no single TTC strategy is optimal). "Self-verification" → 2025 work shows stated self-verify is often *fake* (use a SEPARATE verifier, not self-critique).

**Iter-6 takeaway:** the two biggest levers are now (1) a **current thinking backbone** (Qwen3-4B-Thinking, ~free) and (2) **executing the distillation** we already prepped (technique→weights). Plus the two cheap table-stakes we're missing: a **reranker** and a **current embedder**. Everything else is orchestration polish on an already-strong stack.

## LIVE BOARD FINDING (2026-06-22, fixed harness, qwen2.5:7b on T4) — partial, college_mathematics (n=20)
- **baseline 35% (7/20) · brain 65% (13/20) · champion 50% (10/20).**
- **WIN: the brain (retrieval) nearly DOUBLES baseline on math** — clean live evidence for "technique not horsepower."
- **BUG: champion (council) UNDERPERFORMS plain brain (50% < 65%)** on math. The council democratically blends baseline(weak)+brain(strong)+qgen, so it DILUTES a dominant grounded arm. Classic ensemble failure mode: averaging hurts when one arm is decisively better.
- **PLANNED FIX — council V2 (apply AFTER the full 7-subject board confirms it's systematic, not just math; flag-gated `MMLU_COUNCIL_V2` so it A/Bs without disturbing the current comparison):** confidence/grounding-weighted council — when the brain arm's retrieval is strong (high top-cosine) AND it disagrees with baseline, defer to brain rather than majority-average. I.e. let a decisively-grounded arm win instead of being out-voted by weaker arms. Do NOT implement off 1 subject (premature); wait for per-subject board data. This is the highest-priority *new* gap the loop surfaced — it's our own bug, not a borrow.
- Process note: the heartbeat fix (PR #83) is what made this finding VISIBLE in real time — the old harness would have shown nothing.

## Iter-7 (2026-06-22) — UNMINED labs + the combiner literature (2 fresh agents). TOP 50 = these + iter-6's 25.

**Overlap analysis that drove this** (real board data): on college_math baseline & brain got LARGELY COMPLEMENTARY subsets (both-right 6, brain-only 7, baseline-only 1, oracle 14/70%); on college_chem they OVERLAP (both-right 10). So the council dilutes only where arms are complementary. The frontier diagnosis: **our LLM arms (baseline, sc, qgen-reasoning) are CORRELATED/entangled — same errors — so a flat vote lets the bloc swamp the INDEPENDENT brain-retrieval arm.**

### P0 — CONDITIONAL COMBINER / ROUTING / CALIBRATION (directly fixes our live council bug)
| Move | Source (arXiv) | Gives us |
|---|---|---|
| **Beyond Majority Voting (OW/ISP aggregators)** | 2510.01499 | correlation-aware aggregation — up-weight the surprising-but-correct minority (our exact fix); provably > majority on MMLU |
| **Entanglement-aware verifier reweighting** | 2604.07650 | measure pairwise correlated-error, give INDEPENDENT arms more vote share (brain is independent; LLM arms entangled) |
| **Conformal abstention policies** | 2502.06884 | per-arm trust/abstain gate with coverage guarantee |
| **Trust-or-Escalate cascade** | ICLR'25 | accept a verdict only when calibrated confidence bounds agreement, else escalate |
| **Calib-n response-agreement calibration** | 2501.03991 (ACL'25 Outstanding) | cheap agreement-feature gate, beats logit/verbalized confidence |
| **CARROT cost-aware rate-optimal router** | 2502.03261 | laptop-runnable learned router (KNN/RoBERTa) — route math→verified arm |
| **MoICL learnable expert-weighting head** | 2411.02830 (ACL'25) | replace fixed vote with a learnable per-expert weighting (our "softmax the ensemble") |
| **Optimal deferral / speculative cascades** | 2405.19261 (ICLR'25) | the math for WHEN to escalate small→heavy |
| **Entropy insufficient for selective prediction** | 2603.21172 | CONSTRAINT: gate on the sympy verifier's pass/fail, NOT LLM entropy |

### P0 — NEUROSYMBOLIC (our thesis — verified arm should OVERRIDE, not vote)
| **LLM-Modulo (verifiers as critics)** | 2402.01817 | nothing emits unless a sound critic (sympy/SAT/prover) signs off — our compute-override generalized |
| **SymCode (NL→SymPy→sandbox pass/fail + self-debug)** | 2510.25975 | upgrade our sympy arm; make pass/fail the ROUTING signal (+13.6 MATH-500) |
| **LLM2 process verifier × self-consistency** | 2412.20372 (NAACL'25) | generator × verifier × SC compose multiplicatively (GSM8K 50→70) — validates our stack |
| **VSA hidden-state reasoning (Waterloo/Eliasmith)** | 2502.01657 (EMNLP'25) | encode hidden states → VSA → compute → decode: 15.4× more math; validates our VSA/HRR substrate |
| **Global Workspace routing** | 2503.01906 | arbitrate arm disagreement (neural X vs verifier ¬X), broadcast only the consistent result |

### P1 — COUNCIL → WEIGHTS (turn the ensemble into one small model — Sakana/Together)
Evolutionary Model Merging (2403.13187, Sakana, Nature MI) · CycleQD (2410.14735) · **MoA** (2406.04692, Together) + **MoAA distill-council-into-one-model** (2505.03059) · Self-MoA (2502.00674) · Text-to-LoRA (2506.06105) / Doc-to-LoRA (2602.15902) · The Avengers (2505.19797). **Sakana = highest-value unmined lab; Together MoAA = the "distill council to one on-device model" path.**

### P1 — RETRIEVAL / RERANK / EMBED (the table-stakes we're missing)
**NVIDIA RankRAG** (2407.02485 — ONE model reranks+answers) · **Snowflake Arctic-Embed-2.0** (Apache, quant-aware, ~128B/vec — the nomic replacement) · **Contextual Reranker v2** (open, instruction-steerable — our missing rerank stage) · NVIDIA ColEmbed late-interaction (2507.05513) · Tencent Youtu-GraphRAG (2508.19855).

### P2 — EFFICIENCY / SMALL BACKBONES / SAMPLING
Apple 2-bit QAT+LoRA (2507.13575) + MLX · Reka Quant 3.5-bit · SmolLM3-3B · Mistral 3 (Apache) · **Minions** (2502.15964, Stanford — small reads context, big orchestrates, 97.9% acc @17.5% cost) · **Slim-SC + Bayesian SC stopping** (2509.13990 — −45% latency, drop-in on our self-consistency) · smolagents agentic-RAG.

### Eval / thesis-validation
LMUnit (grounding unit-tests) · ARES · RouterArena · Databricks long-context-RAG (2411.03538 — retrieval+short-ctx > long-ctx dump, BACKS our thesis) · SFR-RAG/ContextualBench · **"Does RL Really Incentivize Reasoning Beyond the Base Model?"** (2504.13837, NeurIPS'25 runner-up — capacity is LATENT in the base, wins come from sampling/selection = independent validation of "technique not horsepower").

**Iter-7 takeaway:** the single highest-leverage move is **correlation/entanglement-aware aggregation** (2510.01499 + 2604.07650) + **letting the verified-compute arm OVERRIDE** (LLM-Modulo) — exactly our live council bug. Council V2 (PR #90 + the confidence-weighting this turn) is a first-order approximation; the learned/correlation-aware combiner is the principled endgame. Beyond the combiner: **distill the council into one small model** (MoAA/Sakana) is the way to make the technique permanent and cheap.
