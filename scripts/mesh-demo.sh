#!/usr/bin/env bash
# Noetica mesh — on-demand demo lifecycle.
# Spin the local mesh up for an hour or a day, reliably, for client demos:
#
#   scripts/mesh-demo.sh up       clean start: supervised Agent Machine (auto-restart) +
#                                  24GB-safe memory caps + pre-warmed fast models
#   scripts/mesh-demo.sh down      clean teardown (stops the AM + lets managed Ollama release)
#   scripts/mesh-demo.sh status    what's running + which model is hot + free RAM
#   scripts/mesh-demo.sh logs      tail the mesh log
#
# This runs the mesh ENGINE (Agent Machine + the app-managed Ollama). To show the UI in a
# demo, launch the desktop app separately — `npm run dev:app` reuses this AM on :8080.
#
# Why a launcher: a bare `tsx server.ts` leaves stray processes, no memory caps, no restart on
# crash, and a cold model on the first query. This gives a clean, capped, supervised, pre-warmed
# mesh that survives a full demo day and tears down without leftovers.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$HOME/.noetica/demo"; mkdir -p "$DIR"
SUP_PID="$DIR/supervisor.pid"
LOG="$DIR/mesh.log"
AM_PORT="${NOETICA_AM_PORT:-8080}"
OLLAMA_PORT=11435
OLLAMA_HOST="http://127.0.0.1:${OLLAMA_PORT}"
# The responsive base model (what the first turn actually hits) — pre-warm it so demos open snappy.
# With 1 model hot, the mesh escalates to a bigger model on hard turns (evicting this one).
WARM=(llama3.2:3b)

is_up()     { curl -sf -m2 "http://127.0.0.1:${AM_PORT}/api/status" >/dev/null 2>&1; }
is_ollama() { curl -sf -m2 "${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; }
# The AM answers :8080 before its app-managed Ollama is back up after a restart — gate on BOTH,
# or the first demo query lands in a window with no model and comes back empty.
is_ready()  { is_up && is_ollama; }

down() {
  if [ -f "$SUP_PID" ]; then kill "$(cat "$SUP_PID")" 2>/dev/null || true; rm -f "$SUP_PID"; fi
  pkill -f "agent-machine.*server\.ts" 2>/dev/null || true
  sleep 1
  echo "[mesh] down."
}

up() {
  echo "[mesh] clean start…"
  down >/dev/null 2>&1 || true
  # Supervised AM with 24GB-safe Ollama caps inline, auto-restart on crash for day-long stability.
  nohup bash -c '
    while true; do
      ( cd "'"$ROOT"'/agent-machine" \
        && NOETICA_AM_PORT="'"$AM_PORT"'" \
           OLLAMA_HOST="'"$OLLAMA_HOST"'" \
           OLLAMA_MAX_LOADED_MODELS=1 \
           OLLAMA_NUM_PARALLEL=1 \
           OLLAMA_FLASH_ATTENTION=1 \
           OLLAMA_KEEP_ALIVE=4h \
           npx tsx server.ts )
      echo "[mesh] AM exited ($?), restarting in 2s…"
      sleep 2
    done
  ' > "$LOG" 2>&1 &
  echo $! > "$SUP_PID"

  printf "[mesh] starting (AM + managed Ollama, up to ~2m)"
  for _ in $(seq 1 60); do is_ready && break; printf "."; sleep 2; done
  printf "\n"

  if is_ready; then
    for m in "${WARM[@]}"; do
      curl -s -m120 "${OLLAMA_HOST}/api/generate" \
        -d "{\"model\":\"${m}\",\"prompt\":\"ready\",\"stream\":false,\"options\":{\"num_predict\":1}}" \
        >/dev/null 2>&1 &
    done
    echo "[mesh] ✅ UP"
    echo "       API : http://127.0.0.1:${AM_PORT}"
    echo "       UI  : run 'npm run dev:app' (reuses this AM)"
    echo "       caps: 1 model hot · 4h keep-alive · pre-warming ${WARM[*]}"
  else
    echo "[mesh] ✗ did not come up in time — last log lines:"
    tail -n 10 "$LOG"
    return 1
  fi
}

status() {
  is_up && echo "  AM      : UP   (:${AM_PORT})" || echo "  AM      : down"
  curl -sf -m2 "${OLLAMA_HOST}/api/tags" >/dev/null 2>&1 \
    && echo "  Ollama  : UP   (:${OLLAMA_PORT})" || echo "  Ollama  : down"
  curl -s -m3 "${OLLAMA_HOST}/api/ps" 2>/dev/null | python3 -c "
import sys,json
ms=json.load(sys.stdin).get('models',[])
print('  Hot     :', (', '.join(m['name'] for m in ms) or 'none'), '(%.1fGB)'%(sum(m['size'] for m in ms)/1e9))
" 2>/dev/null || echo "  Hot     : —"
  vm_stat | awk '/Pages free/{f=$3} /Pages active/{a=$3} END{printf "  Free RAM: ~%.1fGB (active ~%.1fGB)\n", f*4096/1e9, a*4096/1e9}'
  [ -f "$SUP_PID" ] && echo "  Restart : supervised (pid $(cat "$SUP_PID"))" || echo "  Restart : not supervised"
}

case "${1:-}" in
  up)     up ;;
  down)   down ;;
  status) status ;;
  logs)   tail -n 40 -f "$LOG" ;;
  *)      echo "usage: $(basename "$0") {up|down|status|logs}"; exit 1 ;;
esac
