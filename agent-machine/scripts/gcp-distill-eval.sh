#!/bin/bash
# gcp-distill-eval — MEASURE the canon-distillation lift: board the trained sovereign model against its base on
# the EXISTING harness (gcp-board-robust.sh), same arms/subjects/seed, so the only variable is the weights.
# This closes the loop: build-distill-dataset.py → gcp-distill-train.sh → THIS. The empty-column claim is only
# real once it's measured (memory: operator-board n50 = THE measurement; board_keep_all_promote_winners).
#
# It's a thin, documented wrapper — the heavy lifting is the proven board. Like its siblings it is DRY-RUN by
# default and only invokes the board with --confirm.
#
#   bash scripts/gcp-distill-eval.sh             # print the two board invocations, run NOTHING
#   bash scripts/gcp-distill-eval.sh --confirm   # actually launch base then sovereign boards
#
# Usage: RUN_TAG=sovereign-v1 BASE_OLLAMA=qwen2.5:7b \
#          bash scripts/gcp-distill-eval.sh [--confirm]
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

CONFIRM=0
for a in "$@"; do case "$a" in --confirm) CONFIRM=1;; esac; done

RUN_TAG="${RUN_TAG:-sovereign-v1}"
TAG="${RUN_TAG#sovereign-}"                     # matches gcp-distill-train artifact naming (sovereign-$TAG)
GCS="gs://sourceos-artifacts-socioprophet/ocw-corpus"
MODEL_OUT="$GCS/models/sovereign-$TAG"
# The base side runs on the stock ollama tag; the sovereign side runs the trained GGUF, which the board VM must
# pull from $MODEL_OUT and register into ollama (BOARD_MODEL_GGUF below tells the board where to find it).
BASE_OLLAMA="${BASE_OLLAMA:-qwen2.5:7b}"
SOVEREIGN_OLLAMA="sovereign-$TAG"          # the ollama model name the board VM will `ollama create`
ARMS="${BOARD_ARMS:-baseline,brain,gate,champion}"
SUBJECTS="${SUBJECTS:-high_school_biology,conceptual_physics,electrical_engineering,college_chemistry,high_school_statistics,college_mathematics,abstract_algebra}"
PER="${PER:-50}"                                # memory feedback_board_min_n: never < 30
SEED="${MMLU_SEED:-1729}"

cat <<PLAN
# ────────────────────────────────────────────────────────────────────────────────────────────
# gcp-distill-eval · MEASURE the canon-distillation lift  (run_tag=$RUN_TAG)
# ────────────────────────────────────────────────────────────────────────────────────────────
#   base model      : $BASE_OLLAMA          (stock ollama tag)
#   sovereign model : $SOVEREIGN_OLLAMA  ← $MODEL_OUT/sovereign-$TAG.gguf
#   arms            : $ARMS
#   subjects        : $SUBJECTS
#   per-subject     : $PER   (≥30 floor)   ·   seed $SEED   (identical for both → only weights differ)
#   harness         : scripts/gcp-board-robust.sh (the proven resumable/streaming/stall-guarded board)
#
#   Two identical boards, one variable (the weights):
#     A) BASE       : BOARD_MODEL=$BASE_OLLAMA       RUN_TAG=${RUN_TAG}-base
#     B) SOVEREIGN  : BOARD_MODEL=$SOVEREIGN_OLLAMA  RUN_TAG=${RUN_TAG}-sov   (board VM pulls + ollama-creates the GGUF)
#   Then board-compare.py reads both ckpts → the distillation Δ (overall + per-subject), n50 style.
# ────────────────────────────────────────────────────────────────────────────────────────────
PLAN

CMD_BASE="BOARD_MODEL=$BASE_OLLAMA RUN_TAG=${RUN_TAG}-base BOARD_ARMS=\"$ARMS\" \\
  SUBJECTS=\"$SUBJECTS\" PER=$PER MMLU_SEED=$SEED bash $HERE/gcp-board-robust.sh"
# The sovereign board needs the GGUF registered into ollama on the board VM. BOARD_MODEL_GGUF points the
# board's startup-script at the trained artifact; absent that env the board pulls a stock tag, so this is the
# one knob that makes the board score OUR weights. (Wiring it into gcp-board-robust.sh is the follow-up.)
CMD_SOV="BOARD_MODEL=$SOVEREIGN_OLLAMA BOARD_MODEL_GGUF=$MODEL_OUT/sovereign-$TAG.gguf \\
  RUN_TAG=${RUN_TAG}-sov BOARD_ARMS=\"$ARMS\" SUBJECTS=\"$SUBJECTS\" PER=$PER MMLU_SEED=$SEED \\
  bash $HERE/gcp-board-robust.sh"

if [ "$CONFIRM" != "1" ]; then
  echo
  echo "DRY-RUN — launches nothing. The two board invocations that measure the lift:"
  echo
  echo "# A) base:"; echo "$CMD_BASE"; echo
  echo "# B) sovereign:"; echo "$CMD_SOV"; echo
  echo "# compare:"; echo "python3 $HERE/board-compare.py ${RUN_TAG}-base ${RUN_TAG}-sov"
  echo
  echo "Re-run with --confirm to launch both boards."
  exit 0
fi

echo "# distill-eval CONFIRMED — launching base board, then sovereign board"
eval "$CMD_BASE"
eval "$CMD_SOV"
echo "=== both boards launched. When both finish: python3 $HERE/board-compare.py ${RUN_TAG}-base ${RUN_TAG}-sov ==="
