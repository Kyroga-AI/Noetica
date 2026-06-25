#!/usr/bin/env bash
# resilient OCW crawl — the capture is resumable (done_set reads the captured course files), so just
# re-launch it until ~all 2,577 are captured. Survives crashes/timeouts: each restart resumes.
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
cd "$(dirname "$0")/.."
GCS="gs://sourceos-artifacts-socioprophet/knowledge-commons/courseware/mit/courses/"
for attempt in $(seq 1 200); do
  done=$(gcloud storage ls "$GCS" 2>/dev/null | wc -l | tr -d ' ')
  echo "[$(date +%H:%M:%S)] attempt $attempt — $done/2577 captured"
  [ "$done" -ge 2570 ] && { echo "CAPTURE COMPLETE ($done)"; break; }
  OCW_LIMIT=0 OCW_DELAY_MS=1000 python3 scripts/ocw-resource-capture.py >> /tmp/ocw-full-crawl.log 2>&1
  sleep 20
done
