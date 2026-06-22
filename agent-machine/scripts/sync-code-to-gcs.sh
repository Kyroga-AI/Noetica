#!/usr/bin/env bash
# sync-code-to-gcs — push the CURRENT agent-machine source to the GCS path the GPU eval VMs pull from
# ($GCS/code/agent-machine), so a board re-run includes local fixes.
#
# WHY THIS EXISTS: gcp-gpu-eval.sh provisions a VM that does `gsutil cp $GCS/code/agent-machine/* ...`
# (NOT a git clone). If the code in GCS is stale, the board silently re-measures OLD code. After a change
# that affects retrieval/scoring (e.g. the brain-vec decode-alignment fix), you MUST run this first or the
# board won't reflect it. The brain artifact itself does NOT need rebuilding for a decode-side fix —
# encodeVec is byte-identical to the prior encoder, so the existing brain-complete.tar.gz stays valid.
#
# Usage:  bash scripts/sync-code-to-gcs.sh        # then: GCP_PROJECT=socioprophet-platform bash scripts/gcp-gpu-eval.sh
set -euo pipefail

GCS="${GCS:-gs://sourceos-artifacts-socioprophet/ocw-corpus}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"   # the agent-machine/ dir

echo "# syncing $HERE → $GCS/code/agent-machine"
echo "# (excluding node_modules / dist / .next / .git — the VM runs 'npm ci' to rebuild deps)"
gsutil -m rsync -r \
  -x '(^|.*/)node_modules/.*$|(^|.*/)dist/.*$|(^|.*/)\.next/.*$|(^|.*/)\.git/.*$' \
  "$HERE" "$GCS/code/agent-machine"

echo "# done. The next eval run will use this code."
echo "# run the board:  GCP_PROJECT=socioprophet-platform bash scripts/gcp-gpu-eval.sh"
