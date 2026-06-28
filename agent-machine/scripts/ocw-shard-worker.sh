#!/usr/bin/env bash
# ocw-shard-worker — ONE disjoint OCW capture worker (shard i of N). Resumable self-loop: re-runs the capture
# (which skips already-done courses) until ~all 2,577 are in. Identifiable in `ps` as "ocw-shard-worker.sh i N"
# so the ensure-driver can tell which shards are alive. OCW_SHARD=i/N makes this worker own queue[i::N] only.
#   bash scripts/ocw-shard-worker.sh 3 10 1000
i="$1"; N="$2"; DELAY_MS="${3:-1000}"
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
cd "$(dirname "$0")/.."
GCS="gs://sourceos-artifacts-socioprophet/knowledge-commons/courseware/mit/courses/"
for attempt in $(seq 1 500); do
  d=$(gcloud storage ls "$GCS" 2>/dev/null | wc -l | tr -d ' ')
  [ "$d" -ge 2570 ] && { echo "[shard $i/$N] CAPTURE COMPLETE ($d)"; break; }
  OCW_LIMIT=0 OCW_DELAY_MS="$DELAY_MS" OCW_SHARD="$i/$N" python3 scripts/ocw-resource-capture.py
  sleep 15
done
