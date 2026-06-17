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
               OLLAMA_URL="https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-linux-arm64.tgz" ;;
      *)       TRIPLE="x86_64-unknown-linux-gnu"
               OLLAMA_URL="https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-linux-amd64.tgz" ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

# Allow CI to override triple (e.g. cross-compilation)
TRIPLE="${TAURI_TARGET_TRIPLE:-$TRIPLE}"

echo "==> Downloading Ollama ${OLLAMA_VERSION} for ${TRIPLE}..."

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

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
