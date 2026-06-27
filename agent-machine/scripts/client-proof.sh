#!/usr/bin/env bash
# client-proof — walk into a client, prove our sovereign mesh matches the frontier, LIVE.
#
# THREE STEPS. This script runs step 2 (and preflights it); steps 1 and 3 are the infra-as-code
# you already have (lib/cloud-provision.ts — createCommand/teardownCommand, broker-picked GPU).
#
#   1. SPIN UP the GPU mesh — cheapest GPU via the broker, served as an OpenAI-compatible endpoint:
#        # print the create command for a GCP L4 (cheapest inference GPU in COMPUTE_CATALOG):
#        node --input-type=module -e \
#          "import('./lib/cloud-provision.js').then(m=>console.log(m.createCommand('gcp','g2-standard-8','us-central1','noetica-proof')))"
#        # run it; then ON the node:  OLLAMA_HOST=0.0.0.0:11434 ollama serve &  &&  ollama pull qwen2.5-coder:7b
#        export MESH_URL="http://<node-ip>:11434/v1"  MESH_MODEL="qwen2.5-coder:7b"
#      (No cloud handy? Skip this — MESH_URL defaults to the on-device mesh and the proof still runs.)
#
#   2. PROVE — this script: health-checks the endpoint, runs the live head-to-head, prints the
#      scoreboard, writes an artifact the client keeps. Frontier arms switch on when keys are set:
#        export ANTHROPIC_API_KEY=...     # adds a live Claude arm   (CLAUDE_MODEL to pin the id)
#        export OPENAI_API_KEY=...        # adds a live GPT arm      (GPT_MODEL to pin the id)
#        scripts/client-proof.sh [n]      # n caps problem count
#
#   3. TEAR DOWN — no lingering spend:
#        node --input-type=module -e \
#          "import('./lib/cloud-provision.js').then(m=>console.log(m.teardownCommand('gcp','noetica-proof','us-central1')))"
#
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."   # → agent-machine/
N="${1:-}"
MESH_URL="${MESH_URL:-http://127.0.0.1:11435/v1}"

# Frictionless paid run: reuse the BYOK keys already stored in the app's OS keychain (service
# ai.noetica.secrets — set via the in-app provider setup) when the env vars aren't already exported.
# macOS `security`; on Linux export ANTHROPIC_API_KEY/OPENAI_API_KEY yourself.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && command -v security >/dev/null 2>&1; then
  k="$(security find-generic-password -s ai.noetica.secrets -a anthropicApiKey -w 2>/dev/null || true)"
  [ -n "$k" ] && export ANTHROPIC_API_KEY="$k" && echo "  (Anthropic key loaded from the app keychain)"
fi
if [ -z "${OPENAI_API_KEY:-}" ] && command -v security >/dev/null 2>&1; then
  k="$(security find-generic-password -s ai.noetica.secrets -a openaiApiKey -w 2>/dev/null || true)"
  [ -n "$k" ] && export OPENAI_API_KEY="$k" && echo "  (OpenAI key loaded from the app keychain)"
fi

echo "── client-proof preflight ──────────────────────────────────────"
echo "  mesh endpoint : ${MESH_URL}"
if curl -sf -m5 "${MESH_URL}/models" >/dev/null 2>&1; then
  echo "  reachable     : ✓"
else
  echo "  reachable     : ✗  — start the mesh (ollama serve / the GPU node) or fix MESH_URL"
  exit 1
fi
echo "  mesh model    : ${MESH_MODEL:-qwen2.5-coder:7b}"
printf "  frontier arms : "
armed=""
[ -n "${ANTHROPIC_API_KEY:-}" ] && armed="${armed}claude "
[ -n "${OPENAI_API_KEY:-}" ]    && armed="${armed}gpt "
echo "${armed:-none — set ANTHROPIC_API_KEY / OPENAI_API_KEY to prove head-to-head}"
echo "────────────────────────────────────────────────────────────────"

# shellcheck disable=SC2086
exec npx tsx scripts/mesh-vs-frontier.ts ${N}
