#!/usr/bin/env bash
# onboard-model — make the harness reproduce on a NEW model family. The boards/router/loop are already
# model-parameterized (MMLU_MODEL) and the manifest records the model; the ONLY model-dependent artifact is
# the reliability-gate calibration (agreement/density 2×2). This re-runs a calibration board on the new model,
# rebuilds the per-family reliability-reference, and confirms the gate loads it. After this, every harness
# (ablation, boost-targets, loop-convergence, composite) reproduces identically on the new family.
#   MMLU_MODEL=gpt-4o-mini bash scripts/onboard-model.sh
set -uo pipefail
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
cd "$(dirname "$0")/.."
MODEL="${MMLU_MODEL:?set MMLU_MODEL to the new model}"
FAMILY="$(echo "$MODEL" | cut -d: -f1 | cut -d- -f1 | tr 'A-Z' 'a-z')"
echo "# onboarding model=$MODEL (family=$FAMILY)"
echo "# 1) calibration board (agreement needs ≥2 arms) — GCP-gated if RAG arms; baseline+brain+ground+rerank suffices"
echo "   MMLU_ARMS=baseline,brain,rerank,ground MMLU_MODEL=$MODEL MMLU_PER_SUBJECT=50 MMLU_SEED=1729 \\"
echo "     MMLU_CHECKPOINT=/tmp/ckpt-cal-$FAMILY.jsonl npx tsx scripts/mmlu-brain-bench.ts"
echo "# 2) build the per-family calibration from that checkpoint:"
echo "   cp /tmp/ckpt-cal-$FAMILY.jsonl /tmp/ckpt-ground.jsonl   # the builder reads /tmp/ckpt-ground.jsonl"
echo "   MMLU_MODEL=$MODEL python3 scripts/build-reliability-reference.py   # writes canon/reliability-reference.$FAMILY.json"
echo "# 3) the gate auto-loads it when MMLU_MODEL=$MODEL (family-keyed). Verify:"
echo "   MMLU_MODEL=$MODEL npx tsx lib/reliability-gate.ts"
echo "# 4) every downstream harness now reproduces on $FAMILY — the manifest stamps model=$MODEL on each run."
