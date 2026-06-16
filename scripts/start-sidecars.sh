#!/usr/bin/env bash
# Start all HellGraph/Noetica sidecars (Python + Agent Machine).
# Each server is launched in the background and its PID written to /tmp/noetica-pids.
# Run  ./scripts/stop-sidecars.sh  to stop them cleanly.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
SIDECAR_DIR="$ROOT_DIR/opencog-sidecar"
AM_DIR="$ROOT_DIR/agent-machine"
PID_FILE=/tmp/noetica-pids

echo "" > "$PID_FILE"

start_python() {
  local name=$1; local port=$2; local module=$3
  echo "Starting $name on port $port..."
  (cd "$SIDECAR_DIR" && uvicorn "$module" --host 127.0.0.1 --port "$port" --log-level warning) &
  echo "$! $name" >> "$PID_FILE"
}

start_am() {
  echo "Starting agent-machine on port 8080..."
  (cd "$AM_DIR" && npx tsx server.ts) &
  echo "$! agent-machine" >> "$PID_FILE"
}

start_python "hellgraph"     8137 "server:app"
start_python "sae-patch"     8138 "sae_patch:app"
start_python "distill"       8139 "distill_server:app"
start_python "teacher-cache" 8140 "teacher_cache:app"
start_am

echo "All sidecars started. PIDs:"
cat "$PID_FILE"
echo ""
echo "Run ./scripts/stop-sidecars.sh to stop."
