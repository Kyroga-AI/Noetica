# GCP Batch Runbook — the three GPU-shaped jobs

The work this session that the 8 GB local Mac can't run (it thrashes / falls to CPU). All three use the
estate's existing GCP path; the resumable runner is `scripts/gcp-board-robust.sh` (checkpoints to GCS, re-run
the same `RUN_TAG` to resume — a flake costs ≤1 question).

**Common env**
- Project `socioprophet-platform`, SA `sourceos-ci@socioprophet-platform.iam.gserviceaccount.com`
- Buckets: `gs://sourceos-artifacts-socioprophet/ocw-corpus` (corpora/bench), `gs://noetica-brains` (brains/distill)
- Instances: `g2-standard-8` + 1× **L4** (`--accelerator=type=nvidia-l4,count=1`); A100 for the QLoRA train
- On macOS prepend `OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES` to any `gcloud`/`gsutil` call
- Discipline (standing): seed **1729**, **n ≥ 30**/subject, clean-eval (never test answers), never delete bench
  arms, promote only **measured** winners, canon is frontier-authored (never the 7B).

---

## Job 1 — Reasoning-model eval — close the conceptual ceiling  `[task_22463f9c]`
**Question:** does a reasoning model (DeepSeek-R1-distill) as the reason-lane engine beat `qwen2.5:7b` on the
*conceptual* subjects (where this session's reason lane gained only +3pp vs +24pp on computational math)?

```bash
# treatment: reasoning model
OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES \
BOARD_MODEL=deepseek-r1:14b RUN_TAG=r1-concept \
BOARD_ARMS=baseline,reason,opcompute \
SUBJECTS=college_mathematics,abstract_algebra,conceptual_physics,electrical_engineering,astronomy \
PER=30 bash scripts/gcp-board-robust.sh

# control: same harness, base model (re-run same tag to resume; poll status-<tag>.json)
BOARD_MODEL=qwen2.5:7b RUN_TAG=qwen-concept BOARD_ARMS=baseline,reason,opcompute \
SUBJECTS=college_mathematics,abstract_algebra,conceptual_physics,electrical_engineering,astronomy \
PER=30 bash scripts/gcp-board-robust.sh
```
**Compare:** `reason`-arm accuracy R1 vs qwen, per subject. **Cost** ≈ $1–2/run, ~1 h on L4.
**Promotion gate:** wire R1 into the `compute_math`/`prove_reason` intent route in `server.ts` **only if** its
reason-arm beats qwen's by a measured margin on the conceptual subjects with **0 regressions** elsewhere.

---

## Job 2 — RAPTOR tree-build + GraphRAG-Bench measured run  `[task_e9adde53]`
**Question:** how does the REAL production retriever (not the harness's strawman keyword retriever — the 67%
number) score on GraphRAG-Bench, and does RAPTOR lift the Contextual-Summarize tier?

1. **Build RAPTOR indices** over the staged corpora (needs the model for cluster summaries):
   ```bash
   # on the VM, with ollama up:
   npx tsx -e "import {buildRaptorIndex} from './lib/raptor-runtime.js'; import {readFileSync} from 'fs';
     for (const d of ['medical','novel']) {
       const c = JSON.parse(readFileSync(process.env.HOME+'/.noetica/corpus/benchmarks/graphrag-bench/'+d+'_corpus.json','utf8'));
       const text = c[0].context; const chunks = text.split(/\n\n+/).filter(s=>s.trim().length>40);
       const t = await buildRaptorIndex(d, chunks); console.log(d, t.levels.length, 'levels', t.nodes.size, 'nodes'); }"
   ```
2. **Point the harness at the production retriever** instead of the strawman: run `agent-machine` server on the
   VM, then add/flip a `--use-server` path in `scripts/graphrag-bench.py` that POSTs each question to the
   server's retrieval (so we measure `retrieve()`'s dual-layer fusion, not keyword overlap).
3. **Score with their judge:** generation + GraphRAG-Bench `Evaluation/metrics/answer_accuracy.py` (claim-level
   LLM-judge F-beta) on `/tmp/grb_<domain>_answers.json`. Compare against the repo's own
   `run_hipporag2.py` / `run_lightrag.py` baselines.

**Cost** ≈ $2–4 (gen + judge over ~200 Qs/domain). **Gate:** dual-layer must beat the 67% strawman overlap and
land within range of the HippoRAG/LightRAG baselines; RAPTOR must lift the Contextual-Summarize type.

---

## Job 3 — Canon → sovereign-model distillation pilot  `[task_d626afa4]`
**Question:** can we bake the frontier-authored canon into a small quantized model (the on-thesis model-dev
path vs watsonx.ai/Granite), so it answers without canon-in-context?

- **Dataset (already built locally):** `dist/distill-sft.jsonl` — 1,342 pairs, **authoritative-only** (1,337
  frontier canon defs + 5 verified-operator outputs, 0 from the 7B). Upload:
  `gsutil cp dist/distill-sft.jsonl gs://noetica-brains/distill/`
- **Train (A100):** QLoRA fine-tune `qwen2.5:7b` (or a 3B) on the SFT set (trl/peft or unsloth), ~30–60 min.
- **Quantize:** merge LoRA → GGUF Q4 (llama.cpp) → register in ollama as `noetica-distill:7b-q4`.
- **Eval (did the knowledge bake in?):**
  ```bash
  BOARD_MODEL=noetica-distill:7b-q4 RUN_TAG=distill BOARD_ARMS=baseline,brain \
  SUBJECTS=college_mathematics,abstract_algebra,college_chemistry,high_school_biology,high_school_statistics \
  PER=50 bash scripts/gcp-board-robust.sh    # baseline arm = NO canon in context
  ```
**Honest gate:** promote the distilled model **only if** it beats `base qwen + canon-in-context` on held-out
subjects (clean-eval, seed 1729, n ≥ 30). **If retrieval + canon-in-context still wins, KEEP the harness and
document why** — that result *validates* the harness-over-model thesis. Carry dataset + model provenance through
`functional-model-surfaces`. **Cost** ≈ $5–15 (A100 hour + eval).

---

## Sequencing
1. **Job 1** first — cheapest, highest-signal (the conceptual ceiling is the clearest open question).
2. **Job 2** next — proves the shipped dual-layer on the field benchmark.
3. **Job 3** last — the speculative model-dev bet, gated hard so a null result still teaches us.

All jobs are resumable (`gcp-board-robust.sh` GCS checkpoints). Read results from
`gs://sourceos-artifacts-socioprophet/ocw-corpus/bench/status-<tag>.json`, not the raw log.
