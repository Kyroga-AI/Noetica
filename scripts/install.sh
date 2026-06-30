#!/usr/bin/env bash
# install.sh — Noetica one-command bootstrap: zero → chatting.
#
# Closes the single biggest conversion killer in local AI: setup friction.
# One command brings up the headless agent-machine backend + Ollama + a model,
# optionally fetches a brain, health-checks, and tells you how to chat.
#
#   bash scripts/install.sh            # default model (qwen2.5:7b)
#   bash scripts/install.sh --small    # smaller model (llama3.2:3b)
#   bash scripts/install.sh --no-brain # skip the optional brain fetch
#   NOETICA_MODEL=qwen2.5:14b bash scripts/install.sh
#
# Idempotent and exception-safe: re-running is cheap, every external call is
# guarded, and it NEVER hard-fails because the optional brain is missing or
# gcloud auth has expired. Safe under non-TTY (CI / piped) — no prompts hang.
set -euo pipefail

# ── config ────────────────────────────────────────────────────────────────
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AM_DIR="$REPO_DIR/agent-machine"
PORT="${NOETICA_AM_PORT:-8080}"
OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
DEFAULT_MODEL="qwen2.5:7b"
SMALL_MODEL="llama3.2:3b"
EMBED_MODEL="nomic-embed-text"
BRAIN_BUCKET="gs://noetica-brains"
BRAIN_DIR="${HOME}/.noetica/brain"
LOG_DIR="${HOME}/.noetica"
AM_LOG="$LOG_DIR/agent-machine.log"

# ── flags ─────────────────────────────────────────────────────────────────
WANT_BRAIN=1
NO_INPUT=0
MODEL="${NOETICA_MODEL:-$DEFAULT_MODEL}"

usage() {
  cat <<'EOF'
Noetica installer — zero to chatting in one command.

Usage:
  bash scripts/install.sh [options]

Options:
  --small       Use a smaller default model (llama3.2:3b) for low-RAM machines.
  --no-brain    Skip the optional brain download (retrieval needs a brain;
                verified-compute + reasoning work fine without one).
  --no-input    Never prompt; take safe defaults (auto for non-interactive shells).
  -h, --help    Show this help and exit.

Environment overrides:
  NOETICA_MODEL     Model to pull/run         (default: qwen2.5:7b)
  NOETICA_AM_PORT   Backend listen port       (default: 8080)
  OLLAMA_HOST       Ollama endpoint           (default: http://127.0.0.1:11434)

What it does:
  1. Preflight  — checks OS + git / node>=20 / curl, with install hints.
  2. Ollama     — installs if missing, starts it, pulls the model + embeddings.
  3. Deps       — npm install (root + agent-machine).
  4. Brain      — OPTIONAL: fetches a default brain if gcloud is authed; skips cleanly otherwise.
  5. Launch     — starts the agent-machine backend on :$NOETICA_AM_PORT and health-checks it.
  6. Done       — prints the URL + a chat example.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --small)    MODEL="${NOETICA_MODEL:-$SMALL_MODEL}" ;;
    --no-brain) WANT_BRAIN=0 ;;
    --no-input) NO_INPUT=1 ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

# Non-interactive shells (CI, pipes) must never block on a prompt.
[ -t 0 ] || NO_INPUT=1

# ── pretty output ───────────────────────────────────────────────────────────
if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; X=$'\033[0m'
else
  B=""; DIM=""; G=""; Y=""; R=""; C=""; X=""
fi
step() { printf "%s▸%s %s\n" "$C" "$X" "$1"; }
ok()   { printf "  %s✓%s %s\n" "$G" "$X" "$1"; }
warn() { printf "  %s⚠%s %s\n" "$Y" "$X" "$1"; }
info() { printf "  %s%s%s\n" "$DIM" "$1" "$X"; }

mkdir -p "$LOG_DIR"

# Ask y/N safely; in --no-input mode return the default without blocking.
# $1 = prompt, $2 = default (y|n)
ask() {
  local prompt="$1" def="${2:-n}" ans
  if [ "$NO_INPUT" = "1" ]; then
    [ "$def" = "y" ]; return
  fi
  printf "  %s? %s [%s] %s" "$Y" "$prompt" "$([ "$def" = y ] && echo Y/n || echo y/N)" "$X"
  read -r ans || ans=""
  ans="${ans:-$def}"
  case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# ── 1. preflight ────────────────────────────────────────────────────────────
step "Preflight"
OS="unknown"
case "$(uname -s)" in
  Darwin) OS="mac" ;;
  Linux)  OS="linux" ;;
  *) warn "unrecognized OS '$(uname -s)' — proceeding best-effort" ;;
esac
ok "OS: $OS"

MISSING=0
have() { command -v "$1" >/dev/null 2>&1; }

if have git; then ok "git: $(git --version | awk '{print $3}')"; else
  warn "git not found"
  [ "$OS" = mac ] && info "install: xcode-select --install   (or: brew install git)" || info "install: sudo apt-get install -y git"
  MISSING=1
fi

if have node; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${NODE_MAJOR:-0}" -ge 20 ] 2>/dev/null; then
    ok "node: $(node -v)"
  else
    warn "node $(node -v) is too old (need >= 20)"
    info "install: https://nodejs.org  (or: nvm install 20)"
    MISSING=1
  fi
else
  warn "node not found (need >= 20)"
  [ "$OS" = mac ] && info "install: brew install node   (or https://nodejs.org)" || info "install: https://nodejs.org  (or: nvm install 20)"
  MISSING=1
fi

if have curl; then ok "curl present"; else
  warn "curl not found"
  [ "$OS" = mac ] && info "install: brew install curl" || info "install: sudo apt-get install -y curl"
  MISSING=1
fi

if [ "$MISSING" = "1" ]; then
  printf "\n%sMissing prerequisites above must be installed first.%s\n" "$R" "$X"
  echo "Install them, then re-run: bash scripts/install.sh"
  exit 1
fi

# ── 2. ollama + model ───────────────────────────────────────────────────────
step "Ollama"
if have ollama; then
  ok "ollama present: $(ollama --version 2>/dev/null | head -1 || echo installed)"
else
  warn "ollama not found"
  if [ "$OS" = linux ]; then
    if ask "install Ollama now (curl https://ollama.com/install.sh | sh)?" y; then
      if curl -fsSL https://ollama.com/install.sh | sh; then ok "ollama installed"; else
        warn "ollama install failed — install manually from https://ollama.com/download then re-run"
      fi
    else
      warn "skipping ollama install — get it from https://ollama.com/download then re-run"
    fi
  else
    # macOS: prefer brew cask if available; otherwise point at the installer.
    if have brew && ask "install Ollama via Homebrew (brew install --cask ollama)?" y; then
      if brew install --cask ollama; then ok "ollama installed"; else
        warn "brew install failed — download from https://ollama.com/download then re-run"
      fi
    else
      warn "install Ollama from https://ollama.com/download (the .app), then re-run this installer"
    fi
  fi
fi

OLLAMA_READY=0
if have ollama; then
  # Start the daemon if nothing is answering on OLLAMA_HOST.
  if curl -fsS --max-time 3 "$OLLAMA_HOST/api/tags" >/dev/null 2>&1; then
    ok "ollama already serving at $OLLAMA_HOST"
    OLLAMA_READY=1
  else
    step "Starting ollama serve"
    nohup ollama serve >"$LOG_DIR/ollama.log" 2>&1 &
    # poll up to ~20s for the API to come up
    for _ in $(seq 1 20); do
      if curl -fsS --max-time 2 "$OLLAMA_HOST/api/tags" >/dev/null 2>&1; then OLLAMA_READY=1; break; fi
      sleep 1
    done
    [ "$OLLAMA_READY" = 1 ] && ok "ollama serving at $OLLAMA_HOST" || warn "ollama didn't come up — see $LOG_DIR/ollama.log"
  fi
fi

pull_model() {
  local m="$1"
  if [ "$OLLAMA_READY" != 1 ]; then warn "skipping pull of $m (ollama not running)"; return 0; fi
  if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$m"; then
    ok "model present: $m"
  else
    step "Pulling $m (first time only — this can take a while)"
    if ollama pull "$m"; then ok "pulled $m"; else warn "pull of $m failed — retry later with: ollama pull $m"; fi
  fi
}
pull_model "$MODEL"
pull_model "$EMBED_MODEL"

# ── 3. noetica deps ─────────────────────────────────────────────────────────
step "Installing Noetica dependencies"
( cd "$REPO_DIR" && npm install --no-audit --no-fund ) && ok "root deps installed" || { warn "root npm install hit an error — see output above"; }
( cd "$AM_DIR" && npm install --no-audit --no-fund ) && ok "agent-machine deps installed" || { warn "agent-machine npm install hit an error — see output above"; }

# ── 4. brain (optional, graceful) ───────────────────────────────────────────
step "Brain (optional)"
if [ "$WANT_BRAIN" != 1 ]; then
  info "skipped (--no-brain). Verified-compute + reasoning need no brain; only retrieval does."
elif ! have gcloud && ! have gsutil; then
  info "gcloud/gsutil not installed — skipping brain. Verified-compute + reasoning work without one;"
  info "retrieval features light up once a brain is present in $BRAIN_DIR."
else
  # Probe auth WITHOUT failing the install if the token is expired.
  if gcloud auth print-access-token >/dev/null 2>&1 || gsutil ls "$BRAIN_BUCKET" >/dev/null 2>&1; then
    if ask "fetch a default brain from $BRAIN_BUCKET?" y; then
      mkdir -p "$BRAIN_DIR"
      if gcloud storage cp -r "$BRAIN_BUCKET/default/*" "$BRAIN_DIR/" >/dev/null 2>&1 \
         || gcloud storage cp -r "$BRAIN_BUCKET/*" "$BRAIN_DIR/" >/dev/null 2>&1; then
        ok "brain fetched into $BRAIN_DIR"
      else
        info "brain fetch didn't complete (no default brain or transfer error) — continuing without one."
      fi
    else
      info "skipped brain download. Retrieval needs a brain; verified-compute + reasoning don't."
    fi
  else
    info "gcloud present but not authed (token likely expired) — skipping brain. This is fine:"
    info "verified-compute + reasoning work without one. Run 'gcloud auth login' + re-run to add retrieval."
  fi
fi

# ── 5. launch + health-check ────────────────────────────────────────────────
step "Launching the agent-machine backend on :$PORT"
# Free the port if a previous run (or bundled sidecar) holds it — idempotent restart.
if lsof -ti "TCP:$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  info "port $PORT already in use — restarting the backend"
  lsof -ti "TCP:$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1
fi

LAUNCHED=0
if have node; then
  ( cd "$AM_DIR" \
    && NOETICA_AM_PORT="$PORT" OLLAMA_HOST="$OLLAMA_HOST" NOETICA_PREWARM_MODELS="$MODEL" \
       nohup node --import tsx server.ts >"$AM_LOG" 2>&1 & echo $! >"$LOG_DIR/agent-machine.pid" )
  LAUNCHED=1
else
  warn "node missing — cannot launch. Start manually: cd agent-machine && NOETICA_AM_PORT=$PORT node --import tsx server.ts"
fi

HEALTHY=0
if [ "$LAUNCHED" = 1 ]; then
  step "Waiting for health on http://localhost:$PORT/api/status"
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 2 "http://localhost:$PORT/api/status" >/dev/null 2>&1; then HEALTHY=1; break; fi
    sleep 1
  done
  [ "$HEALTHY" = 1 ] && ok "backend healthy on :$PORT" || warn "backend not healthy yet — tail the log: tail -f $AM_LOG"
fi

# ── 6. done ─────────────────────────────────────────────────────────────────
echo
if [ "$HEALTHY" = 1 ]; then
  printf "%s╭───────────────────────────────────────────────────────────╮%s\n" "$G" "$X"
  printf "%s│%s  %sNoetica is up. Zero → chatting, done.%s                     %s│%s\n" "$G" "$X" "$B" "$X" "$G" "$X"
  printf "%s╰───────────────────────────────────────────────────────────╯%s\n" "$G" "$X"
else
  printf "%sNoetica install finished with warnings — see notes above.%s\n" "$Y" "$X"
fi
echo
echo "  Backend : http://localhost:$PORT"
echo "  Model   : $MODEL   (override: NOETICA_MODEL=… )"
echo "  Logs    : $AM_LOG"
echo
echo "  Chat from the terminal:"
printf "%s" "$DIM"
cat <<EOF
    curl -N http://localhost:$PORT/api/chat \\
      -H 'content-type: application/json' \\
      -d '{"messages":[{"role":"user","content":"What is 17 * 23, and prove it?"}]}'
EOF
printf "%s\n" "$X"
echo "  Why Noetica: it's the only local AI that ${B}proves${X} its computed answers —"
echo "  not just citations to check yourself. See docs/COMPETITIVE.md."
echo
echo "  More options: bash scripts/install.sh --help"
