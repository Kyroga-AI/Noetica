#!/usr/bin/env bash
# ocw-crawl-cron — ONE resumable crawl pass, lock-guarded, for cron. Cron firings are detached from any
# interactive session (which is what kept killing the foreground/background launches), so this persists.
# Each firing resumes from the captured-files done_set; a portable mkdir-lock prevents overlapping passes.
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
cd "$(dirname "$0")/.." || exit 1
LOCK=/tmp/ocw-crawl.lockdir
if ! mkdir "$LOCK" 2>/dev/null; then
  pid=$(cat "$LOCK/pid" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "$(date) pass already running (pid $pid), skip"; exit 0; fi
  rm -rf "$LOCK"; mkdir "$LOCK"   # stale lock → take over
fi
echo $$ > "$LOCK/pid"; trap 'rm -rf "$LOCK"' EXIT
GCS="gs://sourceos-artifacts-socioprophet/knowledge-commons/courseware/mit/courses/"
done=$(gcloud storage ls "$GCS" 2>/dev/null | wc -l | tr -d ' ')
[ "$done" -ge 2570 ] && { echo "$(date) CAPTURE COMPLETE ($done/2577)"; exit 0; }
echo "$(date) crawl pass starting at $done/2577"
OCW_LIMIT=0 OCW_DELAY_MS=1000 python3 scripts/ocw-resource-capture.py >> /tmp/ocw-full-crawl.log 2>&1
echo "$(date) pass ended at $(gcloud storage ls "$GCS" 2>/dev/null | wc -l | tr -d ' ')/2577"
