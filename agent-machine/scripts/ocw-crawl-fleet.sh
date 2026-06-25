#!/usr/bin/env bash
# ocw-crawl-fleet — run N disjoint sharded workers in the FOREGROUND under one parent (ends with `wait`), so a
# long-lived holder keeps them alive: a `run_in_background` harness task or the user's terminal. (nohup+disown
# does NOT survive a tool-call shell here — the env reaps it; a background task that blocks on `wait` does.)
# Each shard owns queue[i::N] (OCW_SHARD), self-loops, and resumes from GCS. Watch /tmp/ocw-shard-*.log for 429/403.
#   bash scripts/ocw-crawl-fleet.sh 10        # (launch this via run_in_background)
set -uo pipefail
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES
cd "$(dirname "$0")/.."
N=${1:-${N:-10}}; DELAY_MS=${DELAY_MS:-1000}
echo "# fleet: $N disjoint shards, ${DELAY_MS}ms delay each → /tmp/ocw-shard-*.log"
for i in $(seq 0 $((N - 1))); do
  bash scripts/ocw-shard-worker.sh "$i" "$N" "$DELAY_MS" >> "/tmp/ocw-shard-$i.log" 2>&1 &
done
wait
