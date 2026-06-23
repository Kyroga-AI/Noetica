#!/usr/bin/env bash
# publish-brains — PRODUCER side of the brain injection + update service.
#
# Uploads the packaged brains (dist/brains/*.tar.gz from package-brains.sh) to a GCS bucket at versioned
# paths, makes them public-read, and writes/refreshes the manifest the client reads. The client default
# manifest URL is https://storage.googleapis.com/noetica-brains/brains/manifest.json — so if you use the
# default bucket (gs://noetica-brains), installs pick up new brains with zero per-machine config.
#
# Env:
#   NOETICA_BRAIN_BUCKET   gs:// bucket you own (default gs://noetica-brains). Must be public-read.
#   NOETICA_BRAIN_PREFIX   object prefix (default "brains")
#   BRAIN_VERSION          version stamp (default YYYY.MM.DD) — bump it to trigger client auto-update
#   DIST                   where the .tar.gz live (default ./dist/brains)
set -euo pipefail

BUCKET="${NOETICA_BRAIN_BUCKET:-gs://noetica-brains}"
PREFIX="${NOETICA_BRAIN_PREFIX:-brains}"
VERSION="${BRAIN_VERSION:-$(date +%Y.%m.%d)}"
DIST="${DIST:-$PWD/dist/brains}"
PUBLIC_BASE="https://storage.googleapis.com/${BUCKET#gs://}/$PREFIX"

command -v gsutil >/dev/null || { echo "gsutil not found — install the Google Cloud SDK and 'gcloud auth login'"; exit 1; }

entries=()
publish() {  # <name> <file>
  local name="$1" file="$2"
  if [ ! -f "$file" ]; then echo "# skip $name — $file not found (run package-brains.sh first)"; return; fi
  local sha bytes obj
  sha=$(shasum -a 256 "$file" | awk '{print $1}')
  bytes=$(wc -c < "$file" | tr -d ' ')
  obj="$PREFIX/$name/$VERSION/${name}-brain.tar.gz"
  echo "# uploading $name ($bytes bytes, sha256 $sha) -> $BUCKET/$obj"
  gsutil -q -h "Cache-Control:public,max-age=86400" cp "$file" "$BUCKET/$obj"
  gsutil -q acl ch -u AllUsers:R "$BUCKET/$obj" 2>/dev/null \
    || echo "  (could not set object ACL — if the bucket uses uniform access, grant allUsers objectViewer at the bucket level)"
  entries+=("\"$name\":{\"version\":\"$VERSION\",\"url\":\"$PUBLIC_BASE/$name/$VERSION/${name}-brain.tar.gz\",\"sha256\":\"$sha\",\"bytes\":$bytes}")
}

publish academic    "$DIST/academic-brain.tar.gz"
publish operational "$DIST/operational-brain.tar.gz"

if [ ${#entries[@]} -eq 0 ]; then echo "# nothing to publish — no artifacts in $DIST"; exit 1; fi

# write + upload the manifest
body=$(IFS=,; echo "${entries[*]}")
MANIFEST=$(mktemp)
printf '{"schema":1,"updated_at":"%s","brains":{%s}}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$body" > "$MANIFEST"
echo "# manifest:"; cat "$MANIFEST"
gsutil -q -h "Cache-Control:public,max-age=300" cp "$MANIFEST" "$BUCKET/$PREFIX/manifest.json"
gsutil -q acl ch -u AllUsers:R "$BUCKET/$PREFIX/manifest.json" 2>/dev/null || true
rm -f "$MANIFEST"

echo
echo "# Published to $BUCKET. Verify:  curl -s $PUBLIC_BASE/manifest.json | jq"
if [ "$BUCKET" = "gs://noetica-brains" ]; then
  echo "# Using the default bucket — installs auto-load with NO extra config. Done."
else
  echo "# Custom bucket — point installs at it (one-time):"
  echo "#   export NOETICA_BRAIN_MANIFEST_URL=$PUBLIC_BASE/manifest.json   (or bake into the app build)"
fi
