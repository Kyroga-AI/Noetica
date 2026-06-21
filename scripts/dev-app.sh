#!/usr/bin/env bash
# dev-app — one command to run Noetica with LIVE source code.
#
# The installed app bundles a compiled Agent Machine sidecar + static frontend, so committed
# changes are invisible until a full rebuild. This runs the AM from SOURCE (tsx) and the desktop
# app in dev mode (frontend HMR); the app reuses the source AM on :8080 (see main.rs reuse path),
# so every change — backend and frontend — is live.
#
# Quit the installed Noetica.app first (it holds :8080). Then:  npm run dev:app
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${NOETICA_AM_PORT:-8080}"

echo "[dev] freeing :$PORT (any stale Agent Machine)…"
lsof -ti ":$PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true
sleep 1

echo "[dev] starting Agent Machine from source on :$PORT…"
( cd agent-machine && NOETICA_AM_PORT="$PORT" exec npx tsx server.ts ) &
AM_PID=$!
cleanup() { echo "[dev] stopping Agent Machine ($AM_PID)…"; kill "$AM_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "[dev] waiting for the Agent Machine to come up…"
for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -sf "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1 \
  && echo "[dev] AM healthy ✓" \
  || { echo "[dev] AM did not come up — check the log above"; exit 1; }

echo "[dev] launching the desktop app (frontend HMR; it reuses this AM)…"
npm run tauri:dev
