#!/bin/bash
set -x
rm -rf AppDir *.AppImage *.zsync
set -e

mkdir -p AppDir/usr/bin AppDir/usr/lib/noetica AppDir/usr/share/applications
mkdir -p AppDir/usr/share/icons/hicolor/256x256/apps

# Bundle the app. EXCLUDE developer/runtime data so it can never be swept into the shipped artifact:
# .noetica (per-user chat brain / identity / self-model / transcripts), env files (secrets), .git
# history, and build scratch. The previous `cp -r .` copied EVERYTHING — that is the privacy-leak path.
rsync -a \
  --exclude='.git' --exclude='.noetica' \
  --exclude='.env' --exclude='.env.*' --exclude='*.local' \
  --exclude='AppDir' --exclude='*.AppImage' --exclude='*.zsync' \
  --exclude='.next/cache' --exclude='src-tauri/target' \
  ./ AppDir/usr/lib/noetica/
rm -rf AppDir/usr/lib/noetica/AppDir AppDir/usr/lib/noetica/.git AppDir/usr/lib/noetica/.noetica

# Bundle a node runtime if available, else rely on system node via PATH
if command -v node >/dev/null 2>&1; then
  install -Dm755 "$(command -v node)" AppDir/usr/bin/node || true
fi

# Detect the entrypoint
ENTRY=""
for f in app/server.js server.js src/server.js index.js; do
  if [ -f "AppDir/usr/lib/noetica/$f" ]; then
    ENTRY="$f"
    break
  fi
done
if [ -z "$ENTRY" ]; then
  echo "No node entrypoint found among app/server.js server.js src/server.js index.js — AppImage will be incomplete"
  ENTRY="server.js"
fi

# Desktop file + icon
if [ -f packaging/linux/ai.noetica.app.desktop ]; then
  install -Dm644 packaging/linux/ai.noetica.app.desktop AppDir/usr/share/applications/noetica.desktop
  install -Dm644 packaging/linux/ai.noetica.app.desktop AppDir/noetica.desktop
fi
if [ -f src-tauri/icons/icon.png ]; then
  install -Dm644 src-tauri/icons/icon.png AppDir/usr/share/icons/hicolor/256x256/apps/noetica.png
  install -Dm644 src-tauri/icons/icon.png AppDir/noetica.png
fi

# AppRun launcher — execs node against the detected entrypoint
cat > AppDir/AppRun <<EOF
#!/bin/sh
HERE="\$(dirname "\$(readlink -f "\$0")")"
export PATH="\$HERE/usr/bin:\$PATH"
NODE="\$HERE/usr/bin/node"
[ -x "\$NODE" ] || NODE=node
exec "\$NODE" "\$HERE/usr/lib/noetica/$ENTRY" "\$@"
EOF
chmod 755 AppDir/AppRun

# Fetch appimagetool if needed
[ -x /tmp/appimagetool ] || ( curl -L 'https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage' -o /tmp/appimagetool && chmod +x /tmp/appimagetool )

TAG_NAME=${TAG_NAME:-$(git -c "core.abbrev=8" show -s "--format=%cd-%h" "--date=format:%Y%m%d-%H%M%S")}
OUTPUT=Noetica-x86_64.AppImage

ARCH=x86_64 VERSION="$TAG_NAME" /tmp/appimagetool AppDir "$OUTPUT"
