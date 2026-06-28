#!/usr/bin/env bash
# ocw-crawl-sharded — launch N DISJOINT resilient OCW workers. Each worker owns a stride of the queue
# (OCW_SHARD=i/N → queue[i::N]), so they don't collide (the old failure: every worker walked the same order and
# re-captured the same courses). Each worker loops (resume-on-restart) until ~all 2,577 are captured. Workers are
# nohup+disown'd so they survive this shell. Politeness: OCW_DELAY_MS per worker (default 1000) — raise N for more
# throughput, but watch /tmp/ocw-shard-*.log for HTTP 429/403 (back off N or raise the delay if you see them).
#
#   bash scripts/ocw-crawl-sharded.sh 10          # 10 disjoint workers
#   N=12 DELAY_MS=900 bash scripts/ocw-crawl-sharded.sh
set -uo pipefail
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
cd "$(dirname "$0")/.."
N=${1:-${N:-10}}
DELAY_MS=${DELAY_MS:-1000}
GCS="gs://sourceos-artifacts-socioprophet/knowledge-commons/courseware/mit/courses/"
echo "# launching $N disjoint sharded workers (delay ${DELAY_MS}ms each) → logs /tmp/ocw-shard-*.log"
for i in $(seq 0 $((N - 1))); do
  nohup bash -c '
    i="$1"; n="$2"; delay="$3"; gcs="$4"
    cd "'"$PWD"'"
    export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
    for attempt in $(seq 1 400); do
      done=$(gcloud storage ls "$gcs" 2>/dev/null | wc -l | tr -d " ")
      [ "$done" -ge 2570 ] && { echo "[shard $i] COMPLETE ($done)"; break; }
      OCW_LIMIT=0 OCW_DELAY_MS="$delay" OCW_SHARD="$i/$n" python3 scripts/ocw-resource-capture.py
      sleep 15
    done
  ' _ "$i" "$N" "$DELAY_MS" "$GCS" >> "/tmp/ocw-shard-$i.log" 2>&1 &
  disown
  echo "  ✓ shard $i/$N → pid $!"
  sleep 1
done
echo "# all $N workers launched. progress:  gcloud storage ls $GCS | wc -l"
