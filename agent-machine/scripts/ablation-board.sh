#!/usr/bin/env bash
# ablation-board — measure EACH RAG technique and EACH neurosymbolic (NS) technique individually on the
# board, repeated over multiple seeds, and LOCK IN the results to canon/ablation-results.json. Each
# technique is layered on the BASE (baseline,brain) in its own run, so its standalone delta vs baseline is
# read from the SAME sample (the cleanest per-technique effect). Repeating over SEEDS turns each board into
# a stable, canonical number with a variance — so we can see, durably, where each technique helps, where it
# hurts, and where to combine. Re-runs skip completed (technique,seed) checkpoints → resumable.
#
#   PER=50 SEEDS="1729 2024 42" GROUPS="base rag ns" bash scripts/ablation-board.sh
#
# Local runs cover the NS arms (sympy) + base; the RAG arms need the brain field corpus (GCS) → GCP board.
# Passthrough env: MMLU_MODEL, MMLU_SUBJECTS, MMLU_COMPUTE_GROUND, OLLAMA_HOST.
set -uo pipefail
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
cd "$(dirname "$0")/.."

PER=${PER:-50}
SEEDS=${SEEDS:-"1729 2024 42"}
OUT=${OUT:-canon/ablation-results}
GROUPS=${GROUPS:-"base rag ns"}
mkdir -p "$OUT"

# technique → board arm (each layered on baseline,brain and measured individually)
RAG=(rerank ground qgen hop cohere notecard)     # the layered-RAG techniques (need the brain corpus)
NS=(compute verify autoform ladder elim vsa)          # the neurosymbolic techniques (sympy-backed)

techs=()
[[ " $GROUPS " == *" base "* ]] && techs+=(base)
[[ " $GROUPS " == *" rag "* ]]  && techs+=("${RAG[@]}")
[[ " $GROUPS " == *" ns "* ]]   && techs+=("${NS[@]}")

echo "# ablation: ${#techs[@]} techniques × $(echo $SEEDS | wc -w) seeds × ${PER}/subject"
for tech in "${techs[@]}"; do
  arms="baseline,brain"; [ "$tech" != base ] && arms="baseline,brain,$tech"
  for seed in $SEEDS; do
    ckpt="$OUT/${tech}__seed${seed}.jsonl"
    if [ -s "$ckpt" ]; then echo "  ✓ skip $tech seed$seed (locked)"; continue; fi
    echo "── $tech · seed $seed · arms=$arms ──"
    MMLU_ARMS="$arms" MMLU_SEED="$seed" MMLU_PER_SUBJECT="$PER" python3 scripts/run-manifest.py "${ckpt%.jsonl}.manifest.json"
    MMLU_ARMS="$arms" MMLU_SEED="$seed" MMLU_PER_SUBJECT="$PER" MMLU_CHECKPOINT="$ckpt" \
      npx tsx scripts/mmlu-brain-bench.ts 2>&1 | tail -2
  done
done

# ── RETRIEVAL-KNOB sweep (the "what we search for / what we return" axis) ──────────────────────────────
# Each entry is "label:ENV=val[,ENV=val…]" — a retrieval-knob config measured on the brain arm, so we see
# the effect of HYBRID/MMR/PER_SHOT/SHOT_K/query-mode INDEPENDENTLY of which technique sits on top.
# KNOBS="hybrid:MMLU_HYBRID=1  mmr:MMLU_MMR=0.5  k12:MMLU_SHOT_K=12  pershot5:MMLU_PER_SHOT=5"
for kv in ${KNOBS:-}; do
  label="${kv%%:*}"; envs="${kv#*:}"
  for seed in $SEEDS; do
    ckpt="$OUT/knob-${label}__seed${seed}.jsonl"
    if [ -s "$ckpt" ]; then echo "  ✓ skip knob-$label seed$seed (locked)"; continue; fi
    echo "── knob:$label · seed $seed · $envs ──"
    env $(echo "$envs" | tr ',' ' ') MMLU_ARMS="baseline,brain" MMLU_SEED="$seed" MMLU_PER_SUBJECT="$PER" \
      python3 scripts/run-manifest.py "${ckpt%.jsonl}.manifest.json"
    env $(echo "$envs" | tr ',' ' ') MMLU_ARMS="baseline,brain" MMLU_SEED="$seed" \
      MMLU_PER_SUBJECT="$PER" MMLU_CHECKPOINT="$ckpt" npx tsx scripts/mmlu-brain-bench.ts 2>&1 | tail -2
  done
done

python3 scripts/ablation-aggregate.py "$OUT"
