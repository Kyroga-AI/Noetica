#!/usr/bin/env bash
# Build Noetica agent-machine backend .deb package
set -euo pipefail

VERSION="${1:-0.4.11}"
ARCH="${2:-amd64}"
PACKAGE="noetica"
STAGE_DIR="$(mktemp -d)"
DEB_ROOT="$STAGE_DIR/DEBIAN"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "Building $PACKAGE ${VERSION} (${ARCH})..."

mkdir -p "$DEB_ROOT"
mkdir -p "$STAGE_DIR/usr/lib/noetica"
mkdir -p "$STAGE_DIR/usr/share/noetica"
mkdir -p "$STAGE_DIR/usr/share/doc/noetica"
mkdir -p "$STAGE_DIR/etc/noetica"
mkdir -p "$STAGE_DIR/lib/systemd/system"
mkdir -p "$STAGE_DIR/usr/share/applications"
mkdir -p "$STAGE_DIR/usr/share/metainfo"

# ── Build the agent-machine backend ───────────────────────────────────────────
# Prefer the self-contained Bun binary (no Node runtime dependency).
# Fall back to `node agent-machine/dist/server.js` when bun is unavailable.
RUNTIME_MODE="stub"

if command -v bun >/dev/null 2>&1; then
  echo "bun found — building self-contained agent-machine binary..."
  if (cd "$REPO_ROOT" && npm install && npm run agent-machine:build:binary:linux); then
    BIN="$REPO_ROOT/src-tauri/binaries/agent-machine-x86_64-unknown-linux-gnu"
    if [ -f "$BIN" ]; then
      install -Dm755 "$BIN" "$STAGE_DIR/usr/lib/noetica/agent-machine"
      RUNTIME_MODE="binary"
      echo "Installed self-contained binary (RUNTIME_MODE=binary)."
    else
      echo "WARNING: bun build reported success but binary not found at $BIN" >&2
    fi
  else
    echo "WARNING: bun binary build failed; will attempt node fallback." >&2
  fi
fi

if [ "$RUNTIME_MODE" = "stub" ]; then
  echo "Attempting Node dist fallback (npm run build)..."
  if (cd "$REPO_ROOT/agent-machine" && npm install && npm run build) \
      && [ -f "$REPO_ROOT/agent-machine/dist/server.js" ]; then
    cp -r "$REPO_ROOT/agent-machine/dist" "$STAGE_DIR/usr/lib/noetica/dist"
    if [ -d "$REPO_ROOT/agent-machine/node_modules" ]; then
      cp -r "$REPO_ROOT/agent-machine/node_modules" "$STAGE_DIR/usr/lib/noetica/node_modules"
    fi
    RUNTIME_MODE="node"
    echo "Installed Node dist + node_modules (RUNTIME_MODE=node)."
  else
    echo "WARNING: neither bun nor a working node build is available." >&2
    echo "WARNING: installing a stub launcher; package must be rebuilt with bun or Node >= 20." >&2
  fi
fi

# ── Launcher: picks the installed runtime at service start ─────────────────────
cat > "$STAGE_DIR/usr/lib/noetica/noetica-launch" << 'LAUNCH'
#!/bin/sh
# Noetica agent-machine launcher — picks binary or node dist
export NOETICA_AM_PORT="${NOETICA_AM_PORT:-8080}"
export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
if [ -x /usr/lib/noetica/agent-machine ]; then
  exec /usr/lib/noetica/agent-machine
elif [ -f /usr/lib/noetica/dist/server.js ]; then
  exec /usr/bin/node /usr/lib/noetica/dist/server.js
else
  echo "Noetica agent-machine not built. See /usr/share/doc/noetica/README." >&2
  exit 1
fi
LAUNCH
chmod 755 "$STAGE_DIR/usr/lib/noetica/noetica-launch"

# README documenting how to (re)build if a stub was installed
cat > "$STAGE_DIR/usr/share/doc/noetica/README" << EOF
Noetica agent-machine backend (RUNTIME_MODE=$RUNTIME_MODE)

This package ships the Noetica agent-machine dialogue backend, listening on
NOETICA_AM_PORT (default 8080). It requires a running Ollama instance at
OLLAMA_HOST (default http://127.0.0.1:11434):

    ollama serve

If the service fails to start with "agent-machine not built", rebuild from
source with either:
  - bun:  npm install && npm run agent-machine:build:binary:linux
  - node: cd agent-machine && npm install && npm run build  (Node >= 20)
EOF

# ── Systemd unit ───────────────────────────────────────────────────────────────
cp "$SCRIPT_DIR/noetica.service" "$STAGE_DIR/lib/systemd/system/"

# Desktop and metainfo (if they exist)
for f in ai.noetica.app.desktop ai.noetica.app.metainfo.xml; do
  src="$REPO_ROOT/packaging/linux/$f"
  if [ -f "$src" ]; then
    if [[ "$f" == *.desktop ]]; then
      cp "$src" "$STAGE_DIR/usr/share/applications/"
    elif [[ "$f" == *.xml ]]; then
      cp "$src" "$STAGE_DIR/usr/share/metainfo/"
    fi
  fi
done

# ── DEBIAN metadata ──────────────────────────────────────────────────────────
sed "s/^Version:.*/Version: $VERSION/; s/^Architecture:.*/Architecture: $ARCH/" \
  "$SCRIPT_DIR/control" > "$DEB_ROOT/control"
for f in postinst prerm postrm; do
  cp "$SCRIPT_DIR/$f" "$DEB_ROOT/$f"
  chmod 755 "$DEB_ROOT/$f"
done

OUTPUT="${PACKAGE}_${VERSION}_${ARCH}.deb"
dpkg-deb --build --root-owner-group "$STAGE_DIR" "$OUTPUT"
echo "Built: $OUTPUT (RUNTIME_MODE=$RUNTIME_MODE)"
