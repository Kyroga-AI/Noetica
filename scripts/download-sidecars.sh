#!/usr/bin/env bash
# Downloads the Ollama binary into src-tauri/binaries/ with the triple-suffixed
# filename that Tauri expects for sidecar resolution.
#
# Usage: bash scripts/download-sidecars.sh
#
# Supports macOS (universal fat binary) and Linux x86_64/aarch64.

set -euo pipefail

OLLAMA_VERSION="${OLLAMA_VERSION:-0.30.8}"
BINARIES_DIR="$(dirname "$0")/../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

OS="$(uname -s)"
ARCH="$(uname -m)"

# Determine Tauri target triple and Ollama download URL
case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64|aarch64) TRIPLE="aarch64-apple-darwin" ;;
      *)             TRIPLE="x86_64-apple-darwin" ;;
    esac
    OLLAMA_URL="https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-darwin.tgz"
    ;;
  Linux)
    case "$ARCH" in
      aarch64) TRIPLE="aarch64-unknown-linux-gnu"
               OLLAMA_URL="https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-linux-arm64.tar.zst" ;;
      *)       TRIPLE="x86_64-unknown-linux-gnu"
               OLLAMA_URL="https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-linux-amd64.tar.zst" ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

# Allow CI to override triple (e.g. cross-compilation or universal builds)
TRIPLE="${TAURI_TARGET_TRIPLE:-$TRIPLE}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

_download_ollama() {
  local url="$1"
  echo "==> Fetching ${url}" >&2
  local archive="$WORK/ollama.archive"
  curl -fsSL "$url" -o "$archive"
  # macOS ships .tgz (gzip); Linux switched to .tar.zst (zstd). Pick the right
  # decompressor by extension so both platforms extract cleanly.
  if [[ "$url" == *.zst ]]; then
    tar --zstd -xf "$archive" -C "$WORK"
  else
    tar -xzf "$archive" -C "$WORK"
  fi
  # Archives extract to `ollama` or `bin/ollama` depending on release/platform.
  if [[ -f "$WORK/ollama" ]]; then
    echo "$WORK/ollama"
  elif [[ -f "$WORK/bin/ollama" ]]; then
    echo "$WORK/bin/ollama"
  else
    echo "ERROR: ollama binary not found after extraction" >&2
    find "$WORK" -type f >&2
    exit 1
  fi
}

# Stage Ollama's inference runner. Layout differs by OS: macOS extracts it FLAT
# (llama-server + dylibs alongside `ollama`); Linux puts it under lib/ollama/.
# NOTE: the shipped app does NOT depend on the bundled runner — the agent-machine
# provisions a COMPLETE runtime into ~/.noetica/runtime at first boot (managed-runtime
# / provision-runtime). So this staging is best-effort and NEVER fatal; the bundle
# only needs the `ollama` binary for Tauri's externalBin resolution.
_stage_runner_lib() {
  if [[ -d "$WORK/lib/ollama" || -d "$WORK/lib" ]]; then
    rm -rf "$BINARIES_DIR/lib"; cp -R "$WORK/lib" "$BINARIES_DIR/lib"
    echo "==> Staged Ollama runner (Linux lib/ layout) → $BINARIES_DIR/lib"
  elif [[ -f "$WORK/llama-server" ]]; then
    echo "==> Ollama runner is flat (macOS layout); runtime provisioning supplies the complete runtime at first boot"
  else
    echo "WARNING: no recognizable Ollama runner in archive — runtime will provision one at first boot" >&2
  fi
  return 0
}

if [[ "$TRIPLE" == "universal-apple-darwin" ]]; then
  # Universal macOS build: ollama-darwin.tgz is already a universal fat binary.
  # Tauri's universal bundler resolves sidecars as <name>-universal-apple-darwin.
  # Also write the per-arch copies so local dev builds work on either slice.
  echo "==> Downloading Ollama ${OLLAMA_VERSION} (universal — all triples)..."
  BIN="$(_download_ollama "$OLLAMA_URL")"
  for triple in universal-apple-darwin aarch64-apple-darwin x86_64-apple-darwin; do
    DEST="$BINARIES_DIR/ollama-${triple}"
    cp "$BIN" "$DEST"
    chmod +x "$DEST"
    echo "==> Written: ${DEST}"
    ls -lh "$DEST"
  done
  _stage_runner_lib   # best-effort; runtime provisions the complete runtime at first boot
else
  echo "==> Downloading Ollama ${OLLAMA_VERSION} for ${TRIPLE}..."
  BIN="$(_download_ollama "$OLLAMA_URL")"
  DEST="$BINARIES_DIR/ollama-${TRIPLE}"
  cp "$BIN" "$DEST"
  chmod +x "$DEST"
  echo "==> Ollama binary written to ${DEST}"
  ls -lh "$DEST"
  _stage_runner_lib   # best-effort; runtime provisions the complete runtime at first boot
fi
