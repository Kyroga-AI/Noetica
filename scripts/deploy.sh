#!/usr/bin/env bash
#
# deploy.sh — reliable local deploy of the Noetica desktop app.
#
# Fixes the class of bug that silently undermined development: `tauri build` CACHES the externalBin,
# so a backend-only change rebuilt the agent-machine binary but shipped a STALE one inside the .app.
# This script rebuilds the binary clean, embeds the FRESH one, and then VERIFIES the deployed binary
# hash matches the freshly-built one — failing loud on any mismatch — so "what's deployed == what was
# built" is guaranteed, not assumed. Also handles the macOS launch flakiness (lsregister reset).
#
# Usage:  bash scripts/deploy.sh            # build + deploy + launch + verify
#         NO_LAUNCH=1 bash scripts/deploy.sh  # build + deploy, don't open
set -uo pipefail
cd "$(dirname "$0")/.."

LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
TARGET="${TARGET:-aarch64-apple-darwin}"
BIN="src-tauri/binaries/agent-machine-${TARGET}"
APP_BUILT="src-tauri/target/release/bundle/macos/Noetica.app"
APP_DEST="/Applications/Noetica.app"
sha() { shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'; }

# ── Vendored deps: pin → sync EVERY build (so what ships always matches vendor.manifest.json) ──
# Root cause of the hellgraph-19-versions-stale bug: this script never ran `npm install`, so a bumped
# pin in package.json never actually installed. Sync git-pinned npm deps to their pins + rewrite the
# source-vendored files to their manifest refs. NOETICA_SKIP_VENDOR_SYNC=1 to skip (offline builds).
if [ "${NOETICA_SKIP_VENDOR_SYNC:-0}" != "1" ]; then
  echo "▸ vendored deps → sync to pins (vendor.manifest.json)…"
  npm install --no-audit --no-fund >/tmp/noetica-vendor-root.log 2>&1 || echo "  ⚠ root npm install failed (using existing node_modules) — see /tmp/noetica-vendor-root.log"
  npm --prefix agent-machine install --no-audit --no-fund >/tmp/noetica-vendor-am.log 2>&1 || echo "  ⚠ agent-machine npm install failed (using existing) — see /tmp/noetica-vendor-am.log"
  node scripts/sync-vendored.mjs --write 2>&1 | sed 's/^/  /' || echo "  ⚠ vendored source sync failed (using existing copies)"
else
  echo "▸ vendored sync SKIPPED (NOETICA_SKIP_VENDOR_SYNC=1)"
fi

echo "▸ 0/5 regenerating the stack + symbol indexes (codebase maps, bundled into the binary)…"
node scripts/build-stack-index.mjs >/dev/null 2>&1 || echo "  (stack-index gen skipped)"
node scripts/build-symbol-index.mjs >/dev/null 2>&1 || echo "  (symbol-index gen skipped)"

echo "▸ 1/5 building agent-machine binary (clean — defeats bun's stale-output)…"
rm -f "$BIN"
bun build agent-machine/server.ts --compile --target "bun-${TARGET/aarch64/darwin-arm64}" --outfile "$BIN" >/tmp/noetica-am-build.log 2>&1 \
  || { echo "  ✗ agent-machine build failed:"; tail -15 /tmp/noetica-am-build.log; exit 1; }
BUILT_HASH=$(sha "$BIN"); echo "  ✓ built ${BUILT_HASH:0:12}"

echo "▸ 2/5 building frontend export + desktop bundle…"
# Build the static export EXPLICITLY and FAIL LOUD — a silent build:static failure (e.g. an
# unresolved import) freezes the embedded desktop frontend at the last good export.
rm -rf out
NOETICA_STATIC_EXPORT=1 npm run build:static >/tmp/noetica-next-build.log 2>&1 \
  || { echo "  ✗ frontend export FAILED:"; grep -iE "can't resolve|error|failed" /tmp/noetica-next-build.log | head -8; exit 1; }
grep -rl "out" out/index.html >/dev/null 2>&1 || [ -f out/index.html ] || { echo "  ✗ export produced no out/index.html"; exit 1; }
touch src-tauri/src/main.rs   # force the GUI binary to recompile so it RE-EMBEDS the fresh frontend
node scripts/inject-am-sidecar-config.mjs >/dev/null
# --bundles app: we only ever install the .app (copied to /Applications below). Building the DMG
# installer is unnecessary for a local deploy AND bundle_dmg.sh/hdiutil is flaky — a DMG-only failure
# was aborting the whole deploy even though the .app built fine. Build just the app bundle.
NOETICA_STATIC_EXPORT=1 ./node_modules/.bin/tauri build --bundles app >/tmp/noetica-tauri-build.log 2>&1
TAURI_RC=$?
node scripts/inject-am-sidecar-config.mjs --restore >/dev/null
# Fail loud on a nonzero tauri rc — NOT just a missing dir. A failed build leaves the PRIOR bundle in
# place, so a dir-only check would silently re-ship a stale frontend (exactly the trap that shipped a
# Jun-28 frontend over today's fixes). Require both a clean rc AND the bundle dir.
{ [ "$TAURI_RC" -eq 0 ] && [ -d "$APP_BUILT" ]; } || { echo "  ✗ tauri build FAILED (rc=$TAURI_RC) — refusing to ship a stale bundle:"; grep -iE "error|doesn't exist|failed" /tmp/noetica-tauri-build.log | head; exit 1; }
cp -f "$BIN" "$APP_BUILT/Contents/MacOS/agent-machine"   # defeat the externalBin cache
echo "  ✓ bundled (frontend + binary fresh)"

echo "▸ 3/5 stopping running instances…"
osascript -e 'quit app "Noetica"' 2>/dev/null
pkill -9 -f "Noetica" 2>/dev/null; pkill -9 -f "Contents/MacOS/agent-machine" 2>/dev/null
pkill -9 -f "binaries/agent-machine" 2>/dev/null; pkill -9 -f "noetica-embed" 2>/dev/null; pkill -9 -f "noetica-operator" 2>/dev/null
lsof -ti tcp:8080 2>/dev/null | xargs -r kill -9 2>/dev/null
sleep 2

echo "▸ 4/5 installing to /Applications + verifying integrity…"
rm -rf "$APP_DEST" && ditto "$APP_BUILT" "$APP_DEST"
cp -f "$BIN" "$APP_DEST/Contents/MacOS/agent-machine"
DEPLOYED_HASH=$(sha "$APP_DEST/Contents/MacOS/agent-machine")
if [ "$BUILT_HASH" != "$DEPLOYED_HASH" ]; then
  echo "  ✗ INTEGRITY FAIL — deployed binary ${DEPLOYED_HASH:0:12} != built ${BUILT_HASH:0:12}"; exit 1
fi
echo "  ✓ deployed binary matches built (${DEPLOYED_HASH:0:12})"
codesign --force --deep --sign - "$APP_DEST" >/dev/null 2>&1
xattr -dr com.apple.quarantine "$APP_DEST" 2>/dev/null
"$LSREG" -u "$APP_DEST" 2>/dev/null; sleep 1; "$LSREG" -f "$APP_DEST" 2>/dev/null; sleep 1

if [ "${NO_LAUNCH:-0}" = "1" ]; then echo "▸ 5/5 NO_LAUNCH=1 — done."; exit 0; fi
echo "▸ 5/5 launching + waiting for backend…"
open "$APP_DEST"
for i in $(seq 1 40); do
  sleep 3
  if curl -s --max-time 2 http://127.0.0.1:8080/api/status >/dev/null 2>&1; then echo "  ✓ :8080 up (~$((i*3))s) — deploy verified."; exit 0; fi
done
echo "  ⚠ backend didn't bind :8080 within ~120s — check /tmp/noetica-am-build.log and the app."
exit 1
