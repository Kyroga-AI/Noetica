#!/bin/bash
# run-exam — the reproducible MMLU exam, end to end. One command, pinned seed, all four arms,
# with the clean-eval certificate attached so the result is defensible the moment it prints.
#
#   1. clean-eval certificate   — prove no MMLU test text is in the brain (contamination_audit)
#   2. the exam                 — baseline vs brain vs compute vs route, same small model, seeded
#
# The thesis in one run: if brain/route beat baseline on the IDENTICAL model, the lift is technique.
#
# Usage:   bash scripts/run-exam.sh
# Env:     MMLU_MODEL (default llama3.2:3b-cpu) · MMLU_PER_SUBJECT (default 0 = ALL) ·
#          MMLU_SEED (default 1729) · MMLU_SUBJECTS (default: all brain-ready) ·
#          OLLAMA_HOST (default 127.0.0.1:11434)
set -euo pipefail
cd "$(dirname "$0")/.."

export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
export MMLU_MODEL="${MMLU_MODEL:-llama3.2:3b-cpu}"
export MMLU_SEED="${MMLU_SEED:-1729}"          # pinned → reproducible; cite this with any result
export MMLU_PER_SUBJECT="${MMLU_PER_SUBJECT:-0}"   # 0 = every question (the real exam)
export MMLU_ARMS="${MMLU_ARMS:-baseline,brain,compute,route}"
# Eval correctness > latency: the GPU is saturated by generation, so let nomic embeds WAIT (+retry) instead
# of aborting at 8s into [] (lexical-only) — that flake silently degraded whole boards (v2/v3). See lib/ollama.ts.
export NOETICA_EMBED_TIMEOUT_MS="${NOETICA_EMBED_TIMEOUT_MS:-60000}"
export NOETICA_EMBED_RETRIES="${NOETICA_EMBED_RETRIES:-2}"

echo "════════════════════════════════════════════════════════════════════"
echo "  MMLU EXAM — model=$MMLU_MODEL · seed=$MMLU_SEED · arms=$MMLU_ARMS"
echo "  per-subject=${MMLU_PER_SUBJECT:-ALL} · $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "════════════════════════════════════════════════════════════════════"

echo
echo "── 1. CLEAN-EVAL CERTIFICATE (no MMLU test text in the brain) ──────────"
python3 scripts/contamination_audit.py --k 12 | tail -4
echo
echo "  (a defensible run requires CLEAN above — if it flags leaks, exclude those courses first)"

echo
echo "── 2. THE EXAM (same small model, open-book over the MIT-OCW brain) ────"
npx tsx scripts/mmlu-brain-bench.ts

echo
echo "════════════════════════════════════════════════════════════════════"
echo "  Done. brain/route > baseline on the identical model ⇒ the lift is TECHNIQUE."
echo "  Reproduce: MMLU_SEED=$MMLU_SEED bash scripts/run-exam.sh"
echo "════════════════════════════════════════════════════════════════════"
