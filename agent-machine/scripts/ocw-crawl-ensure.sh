#!/usr/bin/env bash
# ocw-crawl-ensure — the DURABLE parallel driver. Ensures N disjoint sharded workers are running; idempotent, so
# it's safe to fire from cron every few minutes — it relaunches ONLY the shards that have died (self-healing
# fleet) and never duplicates a live shard. Replaces the old single unsharded resilient crawl (which the cron
# fired blindly, stacking colliding workers). Watch /tmp/ocw-shard-*.log for HTTP 429/403 → lower N or raise DELAY.
#   bash scripts/ocw-crawl-ensure.sh 10
#   N=10 DELAY_MS=1000 bash scripts/ocw-crawl-ensure.sh
set -uo pipefail
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
cd "$(dirname "$0")/.."
N=${1:-${N:-10}}
DELAY_MS=${DELAY_MS:-1000}
launched=0
for i in $(seq 0 $((N - 1))); do
  if pgrep -f "ocw-shard-worker.sh $i $N" >/dev/null 2>&1; then
    continue                                   # shard i already alive — leave it
  fi
  nohup bash scripts/ocw-shard-worker.sh "$i" "$N" "$DELAY_MS" >> "/tmp/ocw-shard-$i.log" 2>&1 &
  disown
  launched=$((launched + 1))
  echo "  ↻ launched shard $i/$N (pid $!)"
  sleep 1
done
running=$(ps -eo command 2>/dev/null | grep -c '[o]cw-shard-worker')   # pgrep -fc is unreliable in this sandbox; ps is accurate
echo "# ensure $N shards: launched $launched, now $running workers live (delay ${DELAY_MS}ms each)"
