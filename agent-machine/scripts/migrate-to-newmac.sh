#!/bin/bash
# migrate-to-newmac — copy the OCW grind's resumable STATE + code to a bigger Mac so the
# capture/vectorize pipeline continues there. Idempotent (rsync) — safe to re-run; it
# only sends what changed, so you can sync once now and again right before the cutover.
#
# Prereqs on the NEW Mac:
#   1. Thunderbolt cable connected (or same network) — Thunderbolt Bridge is fastest
#   2. Remote Login ON: System Settings → General → Sharing → Remote Login
#   3. Toolchain installed: run scripts/setup-new-mac.sh there first
#
# Usage:  bash scripts/migrate-to-newmac.sh <user>@<new-mac-host-or-ip>
#         (find the new Mac's Thunderbolt IP on it: ifconfig bridge0 | grep 'inet ')
set -euo pipefail
DEST="${1:?usage: migrate-to-newmac.sh user@host}"
H="$HOME"
RS="rsync -a --partial --info=progress2 --human-readable"

echo "# migrating grind state → $DEST  ($(date '+%H:%M:%S'))"
echo "# (models + node_modules are NOT copied — recreate them with setup-new-mac.sh)"

# 1) STATE — the irreplaceable captured work
$RS "$H/Downloads/MIT OCW/_corpus"              "$DEST:Downloads/MIT OCW/"
$RS "$H/Downloads/MIT OCW/_brain"               "$DEST:Downloads/MIT OCW/"
$RS "$H/Downloads/MIT OCW/_catalog_all_slugs.txt" "$DEST:Downloads/MIT OCW/" 2>/dev/null || true
$RS "$H/Downloads/ocw-staging"                  "$DEST:Downloads/"
# hellgraph atomspace + benchmarks + ledger (the agent's KB)
$RS --exclude='models/' "$H/.noetica"           "$DEST:"

# 2) CODE — source only (no node_modules / .next / build caches)
$RS --exclude='node_modules' --exclude='.next' --exclude='dist' --exclude='.turbo' --exclude='ts/dist' \
    "$H/dev/Noetica"   "$DEST:dev/"
$RS --exclude='node_modules' --exclude='dist' --exclude='ts/dist' \
    "$H/dev/hellgraph" "$DEST:dev/"

echo "# done. On the new Mac: cd ~/dev/Noetica/agent-machine && bash scripts/ocw-grind.sh"
echo "# (it resumes at the current captured count via the manifest — nothing re-downloads)"
