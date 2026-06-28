#!/usr/bin/env bash
# deploy-board — push the changed board+NS+lib files to the bucket the GCP board VM pulls from, via
# single-file `gcloud storage cp` (bulk rsync is classifier-blocked; single-file is allowed). Run this
# (the assistant cannot push), then delete+recreate the board VM so it re-pulls at boot. Then fire the
# full-stack ablation (printed at the end). PIT: deploy + capture the resulting manifest together.
set -uo pipefail
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
BUCKET="gs://sourceos-artifacts-socioprophet/ocw-corpus/code/agent-machine"
FILES=(
  scripts/mmlu-brain-bench.ts scripts/compute_arm.py scripts/model_solve.py scripts/model_verify.py
  scripts/units.py scripts/type-operators.py scripts/induce-operators.py scripts/boost-targets.py
  scripts/run-manifest.py scripts/loop-convergence.py scripts/ablation-board.sh scripts/ablation-aggregate.py
  lib/reliability-gate.ts lib/canon-route.ts lib/canon-lookup.ts
  canon/reliability-reference.json canon/operators-typed.jsonl
)
echo "# deploying ${#FILES[@]} files → $BUCKET"
for f in "${FILES[@]}"; do
  [ -f "$f" ] && gcloud storage cp "$f" "$BUCKET/$f" && echo "  ✓ $f" || echo "  ✗ missing $f"
done
cat <<'INVO'

# ── then delete+recreate the board VM so it re-pulls, and fire the full-stack ablation: ──
PER=50 SEEDS="1729 2024 42" GROUPS="base rag ns" \
  KNOBS="hybrid:MMLU_HYBRID=1  mmr:MMLU_MMR=0.5  symgrounded:MMLU_QUERY_MODE=symbol" \
  MMLU_MODEL=qwen2.5:7b \
  bash scripts/ablation-board.sh
# full-stack single run (all arms together, for the composite ceiling):
MMLU_ARMS="baseline,brain,rerank,ground,qgen,hop,cohere,ladder,verify,compute,autoform,medprompt" \
  MMLU_PER_SUBJECT=50 MMLU_SEED=1729 MMLU_MODEL=qwen2.5:7b \
  MMLU_CHECKPOINT=canon/ablation-results/fullstack__seed1729.jsonl \
  npx tsx scripts/mmlu-brain-bench.ts
INVO
