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

# Allow CI to override triple (e.g. cross-compilation or universal builds)
TRIPLE="${TAURI_TARGET_TRIPLE:-$TRIPLE}"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

_extract_ollama() {
  local url="$1" tmpdir="$2"
  echo "==> Fetching ${url}"
  curl -fsSL "$url" -o "$tmpdir/ollama.tgz"
  tar -xzf "$tmpdir/ollama.tgz" -C "$tmpdir"
  local bin="$tmpdir/ollama"
  [[ ! -f "$bin" ]] && bin="$tmpdir/bin/ollama"
  echo "$bin"
}

if [[ "$TRIPLE" == "universal-apple-darwin" ]]; then
  # Universal macOS build: ollama-darwin.tgz is already a universal fat binary.
  # Tauri expects both triple-suffixed copies in binaries/.
  echo "==> Downloading Ollama ${OLLAMA_VERSION} (universal — both triples)..."
  BIN=$(_extract_ollama "$OLLAMA_URL" "$TMPDIR")
  for arch_triple in aarch64-apple-darwin x86_64-apple-darwin; do
    DEST="$BINARIES_DIR/ollama-${arch_triple}"
    cp "$BIN" "$DEST"
    chmod +x "$DEST"
    echo "==> Written: ${DEST}"
  done
else
  echo "==> Downloading Ollama ${OLLAMA_VERSION} for ${TRIPLE}..."
  BIN=$(_extract_ollama "$OLLAMA_URL" "$TMPDIR")
  DEST="$BINARIES_DIR/ollama-${TRIPLE}"
  cp "$BIN" "$DEST"
  chmod +x "$DEST"
  echo "==> Ollama binary written to ${DEST}"
  ls -lh "$DEST"
fi
