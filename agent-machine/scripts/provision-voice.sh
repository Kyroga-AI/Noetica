#!/usr/bin/env bash
# Provision the Noetica voice runtime: an isolated Python 3.11 (the system Python is too
# new for torch) with coqui-tts (XTTS-v2). Idempotent — safe to re-run. This downloads
# torch + the XTTS model (several GB, a few minutes on first run).
set -euo pipefail
VOICE_DIR="$HOME/.noetica/voice"
VENV="$VOICE_DIR/venv"
mkdir -p "$VOICE_DIR"

command -v uv >/dev/null 2>&1 || { echo "ERROR: uv is required (brew install uv)"; exit 1; }
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[voice] installing ffmpeg (audio I/O)…"
  brew install ffmpeg >/dev/null 2>&1 || echo "[voice] ffmpeg install skipped (brew unavailable) — install it manually if synthesis fails"
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
