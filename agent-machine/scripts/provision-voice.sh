#!/usr/bin/env bash
# Provision the Noetica voice runtime: an isolated Python 3.11 (the system Python is too
# new for torch) with coqui-tts (XTTS-v2). Idempotent — safe to re-run. This downloads
# torch + the XTTS model (several GB, a few minutes on first run).
set -euo pipefail
VOICE_DIR="$HOME/.noetica/voice"
VENV="$VOICE_DIR/venv"
mkdir -p "$VOICE_DIR"

if ! command -v uv >/dev/null 2>&1; then
  echo "ERROR: uv is required. Install it:"
  echo "  macOS/Linux: curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo "  macOS (brew): brew install uv"
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[voice] installing ffmpeg (audio I/O)…"
  if command -v brew >/dev/null 2>&1; then
    brew install ffmpeg >/dev/null 2>&1
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y ffmpeg >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y ffmpeg >/dev/null 2>&1
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm ffmpeg >/dev/null 2>&1
  else
    echo "[voice] ffmpeg install skipped — no known package manager found; install ffmpeg manually if synthesis fails"
  fi
fi

if [ ! -x "$VENV/bin/python" ]; then
  echo "[voice] creating isolated Python 3.11 venv at $VENV …"
  uv venv "$VENV" --python 3.11
fi

echo "[voice] installing coqui-tts (downloads torch — several GB, please wait)…"
uv pip install --python "$VENV/bin/python" coqui-tts

# Accept the XTTS license non-interactively + sanity-check the import.
COQUI_TOS_AGREED=1 "$VENV/bin/python" - <<'PY'
import importlib
for m in ("torch", "TTS"):
    importlib.import_module(m)
print("[voice] deps import OK")
PY

echo "✅ voice runtime provisioned. Sidecar starts automatically on first use."
