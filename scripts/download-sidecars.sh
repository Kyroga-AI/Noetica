#!/usr/bin/env bash
# Downloads the Ollama binary into src-tauri/binaries/ with the triple-suffixed
# filename that Tauri expects for sidecar resolution.
#
# Usage: bash scripts/download-sidecars.sh [--arch arm64|x64]
#
# The Ollama binary already ships as a static single-file executable for macOS,
# so we just download the release archive, extract, and rename.

set -euo pipefail

OLLAMA_VERSION="${OLLAMA_VERSION:-0.30.8}"
BINARIES_DIR="$(dirname "$0")/../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

# Detect target triple (Tauri convention: <name>-<target-triple>)
detect_triple() {
  local arch
  arch="$(uname -m)"
  case "$arch" in
    arm64|aarch64) echo "aarch64-apple-darwin" ;;
    x86_64)        echo "x86_64-apple-darwin" ;;
    *)             echo "x86_64-apple-darwin" ;;  # fallback
  esac
}

TRIPLE="${TAURI_TARGET_TRIPLE:-$(detect_triple)}"

echo "==> Downloading Ollama ${OLLAMA_VERSION} for ${TRIPLE}..."

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# Ollama macOS release is a universal tgz (arm64+x64 fat binary)
# Same archive for all macOS targets — Tauri needs a per-triple named copy.
OLLAMA_URL="https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-darwin.tgz"
echo "==> Fetching ${OLLAMA_URL}"
curl -fsSL "$OLLAMA_URL" -o "$TMPDIR/ollama.tgz"

tar -xzf "$TMPDIR/ollama.tgz" -C "$TMPDIR"

# The tgz extracts to `ollama` or `bin/ollama` depending on release
OLLAMA_BINARY="$TMPDIR/ollama"
if [[ ! -f "$OLLAMA_BINARY" ]]; then
  OLLAMA_BINARY="$TMPDIR/bin/ollama"
fi

DEST="$BINARIES_DIR/ollama-${TRIPLE}"
cp "$OLLAMA_BINARY" "$DEST"
chmod +x "$DEST"

echo "==> Ollama binary written to ${DEST}"
ls -lh "$DEST"
