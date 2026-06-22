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
