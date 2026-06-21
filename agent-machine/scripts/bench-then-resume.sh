#!/bin/bash
# bench-then-resume — run the math-family MMLU benchmark CLEAN (vectorizer paused, so
# ollama is uncontended → no timeout-as-wrong corruption), then auto-resume the
# MMLU-pinned vectorizer where it left off (resumable by per-course file existence).
set -u
cd "$(dirname "$0")/.." || exit 1
LOGS=/tmp/ocw-logs; mkdir -p "$LOGS"
OH=http://127.0.0.1:11434

echo "# clean math benchmark starting $(date '+%H:%M:%S') — vectorizer paused"
OLLAMA_HOST="$OH" \
MMLU_SUBJECTS=college_mathematics,abstract_algebra,high_school_mathematics,high_school_statistics \
MMLU_PER_SUBJECT=20 MMLU_K=4 MMLU_MAX_CHUNKS=250000 MMLU_TIMEOUT_MS=60000 \
  npx tsx scripts/mmlu-brain-bench.ts > "$LOGS/mmlu-math-clean.log" 2>&1

echo "# benchmark done $(date '+%H:%M:%S') — resuming vectorizer"
OLLAMA_HOST="$OH" OCW_DEPTS=18,8,5,7,20,6,12 BRAIN_CONCURRENCY=4 \
  nohup npx tsx scripts/build-corpus.ts >> "$LOGS/vectorize.log" 2>&1 &
echo "# vectorizer resumed (PID $!)"
