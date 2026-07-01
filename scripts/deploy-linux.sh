#!/usr/bin/env bash
#
# deploy-linux.sh — reliable local deploy of the Noetica desktop app on Linux.
#
# Parallel to deploy.sh (macOS); same integrity-guarantee philosophy: rebuilds the
# agent-machine binary clean, embeds the FRESH one in the Tauri bundle, verifies the
# deployed binary hash, then launches and waits for the backend to come up.
#
# Usage:  bash scripts/deploy-linux.sh            # build + deploy + launch + verify
#         NO_LAUNCH=1 bash scripts/deploy-linux.sh  # build + deploy, don't open
#         ARCH=aarch64 bash scripts/deploy-linux.sh  # arm64 build (default: x86_64)
set -uo pipefail
cd "$(dirname "$0")/.."

ARCH="${ARCH:-x86_64}"
TARGET="${ARCH}-unknown-linux-gnu"
BIN="src-tauri/binaries/agent-machine-${TARGET}"
APP_BUILT="src-tauri/target/release/bundle"
sha() { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }

echo "▸ 0/5 regenerating the stack + symbol indexes…"
node scripts/build-stack-index.mjs >/dev/null 2>&1 || echo "  (stack-index gen skipped)"
node scripts/build-symbol-index.mjs >/dev/null 2>&1 || echo "  (symbol-index gen skipped)"

echo "▸ 1/5 building agent-machine binary (clean, target=${TARGET})…"
rm -f "$BIN"
BUN_TARGET="bun-linux-${ARCH/aarch64/arm64}"
bun build agent-machine/server.ts --compile --target "$BUN_TARGET" --outfile "$BIN" >/tmp/noetica-am-build.log 2>&1 \
  || { echo "  ✗ agent-machine build failed:"; tail -15 /tmp/noetica-am-build.log; exit 1; }
BUILT_HASH=$(sha "$BIN"); echo "  ✓ built ${BUILT_HASH:0:12}"

echo "▸ 2/5 building frontend export + desktop bundle…"
rm -rf out
NOETICA_STATIC_EXPORT=1 npm run build:static >/tmp/noetica-next-build.log 2>&1 \
  || { echo "  ✗ frontend export FAILED:"; grep -iE "can't resolve|error|failed" /tmp/noetica-next-build.log | head -8; exit 1; }
[ -f out/index.html ] || { echo "  ✗ export produced no out/index.html"; exit 1; }
touch src-tauri/src/main.rs
node scripts/inject-am-sidecar-config.mjs >/dev/null
NOETICA_STATIC_EXPORT=1 ./node_modules/.bin/tauri build --target "${TARGET}" >/tmp/noetica-tauri-build.log 2>&1
TAURI_RC=$?
node scripts/inject-am-sidecar-config.mjs --restore >/dev/null
[ -d "$APP_BUILT" ] || { echo "  ✗ bundle missing (rc=$TAURI_RC):"; grep -iE "error" /tmp/noetica-tauri-build.log | head; exit 1; }
echo "  ✓ bundled"

echo "▸ 3/5 stopping running instances…"
pkill -f "noetica" 2>/dev/null || true
pkill -f "agent-machine" 2>/dev/null || true
pkill -f "noetica-embed" 2>/dev/null || true
lsof -ti tcp:8080 2>/dev/null | xargs -r kill -9 2>/dev/null || true
sleep 1

echo "▸ 4/5 installing + verifying integrity…"
# Prefer AppImage (self-contained); fall back to deb if built.
APPIMAGE=$(find "$APP_BUILT/appimage" -name "*.AppImage" 2>/dev/null | head -1)
DEB=$(find "$APP_BUILT/deb" -name "*.deb" 2>/dev/null | head -1)
if [ -n "$APPIMAGE" ]; then
  INSTALL_PATH="$HOME/.local/bin/Noetica.AppImage"
  mkdir -p "$(dirname "$INSTALL_PATH")"
  cp -f "$APPIMAGE" "$INSTALL_PATH"
  chmod +x "$INSTALL_PATH"
  # Inject fresh agent-machine binary into the AppImage's squashfs mount (best-effort)
  # Most deployments won't need this — the binary is bundled via tauri.conf.json externalBin
  echo "  ✓ AppImage installed to $INSTALL_PATH"
  # Register desktop entry
  DESK_SRC="packaging/linux/ai.noetica.app.desktop"
  if [ -f "$DESK_SRC" ]; then
    mkdir -p "$HOME/.local/share/applications"
    sed "s|Exec=.*|Exec=$INSTALL_PATH %u|" "$DESK_SRC" > "$HOME/.local/share/applications/noetica.desktop"
    update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
    echo "  ✓ desktop entry registered"
  fi
  LAUNCH_CMD="$INSTALL_PATH"
elif [ -n "$DEB" ]; then
  echo "  installing .deb…"
  sudo dpkg -i "$DEB" >/dev/null 2>&1 \
    || { echo "  ✗ dpkg install failed"; exit 1; }
  echo "  ✓ .deb installed"
  LAUNCH_CMD="noetica"
else
  echo "  ✗ no AppImage or .deb found in $APP_BUILT — Tauri bundle may have failed"
  exit 1
fi

DEPLOYED_BIN=$(find "$APP_BUILT" -name "agent-machine" -type f 2>/dev/null | head -1)
if [ -n "$DEPLOYED_BIN" ]; then
  DEPLOYED_HASH=$(sha "$DEPLOYED_BIN")
  if [ "$BUILT_HASH" != "$DEPLOYED_HASH" ]; then
    echo "  ✗ INTEGRITY FAIL — deployed binary ${DEPLOYED_HASH:0:12} != built ${BUILT_HASH:0:12}"; exit 1
  fi
  echo "  ✓ deployed binary matches built (${DEPLOYED_HASH:0:12})"
fi

if [ "${NO_LAUNCH:-0}" = "1" ]; then echo "▸ 5/5 NO_LAUNCH=1 — done."; exit 0; fi
echo "▸ 5/5 launching + waiting for backend…"
nohup "$LAUNCH_CMD" >/dev/null 2>&1 &
for i in $(seq 1 40); do
  sleep 3
  if curl -s --max-time 2 http://127.0.0.1:8080/api/status >/dev/null 2>&1; then echo "  ✓ :8080 up (~$((i*3))s) — deploy verified."; exit 0; fi
done
echo "  ⚠ backend didn't bind :8080 within ~120s — check /tmp/noetica-tauri-build.log and the app."
exit 1
