#!/usr/bin/env bash
# dev-backend.sh — run the agent-machine from source on :8080 so the installed
# Noetica.app uses your latest local code WITHOUT a rebuild. The app's UI just
# talks to http://127.0.0.1:8080; this replaces the bundled sidecar with source.
#
# Also points Ollama at a working instance (default: system Ollama on :11434) and
# pre-warms a model so the first query isn't a cold-load stall.
#
# Usage:
#   bash scripts/dev-backend.sh                 # foreground
#   OLLAMA_HOST=http://127.0.0.1:11435 bash scripts/dev-backend.sh
set -euo pipefail

AM_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${NOETICA_AM_PORT:-8080}"
export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
export NOETICA_PREWARM_MODELS="${NOETICA_PREWARM_MODELS:-qwen2.5:7b}"
export NOETICA_AM_PORT="$PORT"

echo "▸ stopping anything on :$PORT (bundled sidecar or a previous source run)"
pkill -f "Noetica.app/Contents/MacOS/agent-machine" 2>/dev/null || true
lsof -ti "TCP:$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

echo "▸ ollama target: $OLLAMA_HOST"
if ! curl -s --max-time 3 "$OLLAMA_HOST/api/tags" >/dev/null 2>&1; then
  echo "  ⚠ no Ollama at $OLLAMA_HOST — start one (e.g. 'ollama serve') or set OLLAMA_HOST"
fi

echo "▸ starting source agent-machine on :$PORT (prewarm: $NOETICA_PREWARM_MODELS)"
cd "$AM_DIR"
exec node --import tsx server.ts
