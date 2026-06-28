#!/bin/bash
# sloan-econ-capture — bundle MIT Sloan (course 15, Management/Finance) + Economics (course 14) OCW courses
# into the segmented business/finance/economics commons corpus. CC-only, math-aware (pymupdf), resumable.
# Re-runnable: rebuilds the resume index from per-course manifests first, so an interrupted run skips done.
set -uo pipefail
GCS="gs://sourceos-artifacts-socioprophet/knowledge-commons/courseware/mit"
export OCW_DEPTS="${OCW_DEPTS:-14,15}"
export OCW_DELAY_MS="${OCW_DELAY_MS:-1200}"     # polite over a multi-hundred-course crawl
cd "$(dirname "$0")/.."

echo "# rebuild resume index from per-course manifests ..."
if gcloud storage cat "$GCS"/_manifest_*.jsonl >/tmp/_manifest.jsonl 2>/dev/null && [ -s /tmp/_manifest.jsonl ]; then
  gcloud storage cp /tmp/_manifest.jsonl "$GCS/_manifest.jsonl" >/dev/null 2>&1
  echo "  resume index: $(wc -l </tmp/_manifest.jsonl) courses already done"
else
  echo "  (no prior manifests — fresh crawl)"
fi

echo "# crawl Sloan(15)+Econ(14) → $GCS/courses/"
python3 scripts/ocw-resource-capture.py
echo "# crawl pass complete — re-run this script to resume any that errored."
